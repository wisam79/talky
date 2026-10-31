"""
محرك استدلال Silma-TTS عالي السرعة عبر ONNX Runtime
يوفر أداءً فائقاً على معالجات السحابة (CPU) متجاوزاً بطء PyTorch ODE بحوالي 5 إلى 10 أضعاف.
"""

import os
import time
import math
from pathlib import Path
from typing import Optional, Tuple, Dict, Any, List

import numpy as np
import soundfile as sf
from pydub import AudioSegment
import onnxruntime
from onnxruntime.capi import _pybind_state as C

from .errors import ModelInferenceError

# قاموس تحويل أنواع بيانات ONNX إلى NumPy
ORT_TYPE_TO_DTYPE = {
    "tensor(bool)": np.bool_,
    "tensor(double)": np.float64,
    "tensor(float)": np.float32,
    "tensor(float16)": np.float16,
    "tensor(int8)": np.int8,
    "tensor(int16)": np.int16,
    "tensor(int32)": np.int32,
    "tensor(int64)": np.int64,
    "tensor(uint8)": np.uint8,
    "tensor(uint16)": np.uint16,
    "tensor(uint32)": np.uint32,
    "tensor(uint64)": np.uint64,
}


def numpy_dtype(argument):
    try:
        return ORT_TYPE_TO_DTYPE[argument.type]
    except KeyError as exc:
        raise TypeError(f"نوع ONNX غير مدعوم: {argument.type}") from exc


def resolve_shape(argument, symbols=None, dynamic_sizes=()):
    symbols = {} if symbols is None else symbols
    sizes = iter(dynamic_sizes)
    shape = []
    for dimension in argument.shape:
        if isinstance(dimension, int):
            size = dimension
        elif dimension is not None and dimension in symbols:
            size = symbols[dimension]
        else:
            try:
                size = next(sizes)
            except StopIteration as exc:
                raise ValueError(f"تعذر تحديد أبعاد {argument.name}: {argument.shape}") from exc
            if dimension is not None:
                symbols[dimension] = size
        shape.append(int(size))
    return tuple(shape)


def record_shape(argument, shape, symbols):
    for dimension, size in zip(argument.shape, shape):
        if dimension is not None and not isinstance(dimension, int):
            symbols[dimension] = int(size)


def resolve_from_shape(argument, actual_shape, symbols):
    dynamic_sizes = (
        actual_shape[index]
        for index, dimension in enumerate(argument.shape)
        if not isinstance(dimension, int)
    )
    shape = resolve_shape(argument, symbols, dynamic_sizes)
    record_shape(argument, shape, symbols)
    return shape


def numpy_for(argument, data, shape):
    return np.ascontiguousarray(np.asarray(data, dtype=numpy_dtype(argument)).reshape(shape))


def ortvalue_for(argument, data, shape, device='cpu', device_id=0):
    return onnxruntime.OrtValue.ortvalue_from_numpy(
        numpy_for(argument, data, shape), device, device_id
    )


def empty_ortvalue(argument, shape, device='cpu', device_id=0):
    return onnxruntime.OrtValue.ortvalue_from_shape_and_type(
        shape, numpy_dtype(argument), device, device_id
    )


def same_layout(left, right):
    if left.type != right.type or len(left.shape) != len(right.shape):
        return False
    return all(
        not isinstance(left_dim, int)
        or not isinstance(right_dim, int)
        or left_dim == right_dim
        for left_dim, right_dim in zip(left.shape, right.shape)
    )


def bind_inputs(binding, arguments, values):
    for argument in arguments:
        binding.bind_ortvalue_input(argument.name, values[argument.name])


def bind_outputs(binding, arguments, values):
    for argument in arguments:
        binding.bind_ortvalue_output(argument.name, values[argument.name])


def text_to_char_list(text: str) -> List[str]:
    """تقسيم النص العربي والأحرف إلى قائمة رموز أحرف مطابقة لقالب F5-TTS"""
    custom_trans = str.maketrans({";": ",", "“": '"', "”": '"', "‘": "'", "’": "'"})
    text = text.translate(custom_trans)
    return list(text)


def list_str_to_idx(text_chars: List[str], vocab_map: Dict[str, int], dtype, padding_value=-1):
    text_ids = np.full((1, len(text_chars)), padding_value, dtype=dtype)
    for col, char in enumerate(text_chars):
        text_ids[0, col] = vocab_map.get(char, 0)
    return text_ids


class OnnxSilmaEngine:
    """
    محرك استدلال Silma-TTS فائق السرعة مبني على تقنية ONNX Runtime.
    يحتفظ بالجلسات ومخازن الذاكرة محملة وجاهزة فورياً في الرام.
    """

    def __init__(self, model_dir: str = "/vol/silma-onnx", num_threads: int = 16):
        self.model_dir = Path(model_dir)
        self.num_threads = num_threads
        self.initialized = False
        self.is_cold_start = True

        # مسارات ملفات ONNX
        self.vocab_path = self.model_dir / "vocab.txt"
        self.metadata_path = self.model_dir / "F5_Metadata.onnx"
        self.preprocess_path = self.model_dir / "F5_Preprocess.onnx"
        self.transformer_path = self.model_dir / "F5_Transformer.onnx"
        self.decode_path = self.model_dir / "F5_Decode.onnx"

        # محاولة تحميل مشكّل النصوص العربي إذا توفر
        self.diacritizer = None
        self._init_diacritizer()

        # تحميل الجلسات
        self._load_sessions()

    def _init_diacritizer(self):
        """تهيئة مشكل النصوص العربي عند توفره لتشكيل النصوص غير المشكلة"""
        try:
            from catt_tashkeel import CATTEncoderOnly
            print(">>> [OnnxEngine] تم استدعاء نموذج التشكيل CATTEncoderOnly بنجاح.")
            self.diacritizer = CATTEncoderOnly()
        except Exception as e:
            try:
                from silma_tts.api import SilmaTTS
                st = SilmaTTS()
                if hasattr(st, "tashkeel_model") and st.tashkeel_model:
                    self.diacritizer = st.tashkeel_model
                    print(">>> [OnnxEngine] تم استدعاء مشكل Silma بنجاح.")
            except Exception:
                self.diacritizer = None

    def _load_sessions(self):
        """تحميل نماذج ONNX الثلاثة في الذاكرة مع تهيئة إعدادات الأداء الأقصى"""
        if not self.transformer_path.exists():
            raise FileNotFoundError(f"لم يتم العثور على أوزان ONNX في: {self.transformer_path}")

        print(f">>> [OnnxEngine] جاري تحميل نماذج ONNX من {self.model_dir} مع {self.num_threads} خيط معالجة...")

        # قراءة القاموس
        self.vocab_map = {}
        with open(self.vocab_path, "r", encoding="utf-8") as f:
            for idx, line in enumerate(f):
                self.vocab_map[line.rstrip("\r\n")] = idx
        print(f">>> [OnnxEngine] تم تحميل القاموس: {len(self.vocab_map)} رمز.")

        # قراءة البيانات الوصفية من F5_Metadata.onnx
        sess_meta_opts = onnxruntime.SessionOptions()
        sess_meta_opts.intra_op_num_threads = 1
        meta_sess = onnxruntime.InferenceSession(
            str(self.metadata_path),
            sess_options=sess_meta_opts,
            providers=["CPUExecutionProvider"]
        )
        custom_meta = meta_sess.get_modelmeta().custom_metadata_map
        del meta_sess

        self.sample_rate = int(custom_meta.get("sample_rate", 24000))
        self.in_sample_rate = int(custom_meta.get("in_sample_rate", 24000))
        self.out_sample_rate = int(custom_meta.get("out_sample_rate", 24000))
        self.hop_length = int(custom_meta.get("hop_length", 256))
        self.nfe_step = int(custom_meta.get("nfe_step", 16))
        self.max_signal_length = int(custom_meta.get("max_signal_length", 2048))

        # إعدادات جلسة ONNX فائقة الكفاءة
        session_opts = onnxruntime.SessionOptions()
        session_opts.inter_op_num_threads = 4
        session_opts.intra_op_num_threads = self.num_threads
        session_opts.enable_cpu_mem_arena = True
        session_opts.execution_mode = onnxruntime.ExecutionMode.ORT_SEQUENTIAL
        session_opts.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL

        _configs = {
            "session.set_denormal_as_zero": "1",
            "session.intra_op.allow_spinning": "1",
            "session.inter_op.allow_spinning": "1",
            "session.enable_quant_qdq_cleanup": "1",
            "session.use_device_allocator_for_initializers": "1",
            "session.graph_optimizations_loop_level": "2",
            "optimization.enable_gelu_approximation": "1",
            "optimization.enable_cast_chain_elimination": "1",
        }
        for k, v in _configs.items():
            session_opts.add_session_config_entry(k, v)

        self.run_options = onnxruntime.RunOptions()
        self.run_options.add_run_config_entry("disable_synchronize_execution_providers", "0")

        # تحميل الجلسات الثلاث
        print(">>> [OnnxEngine] [1/3] تحميل F5_Preprocess.onnx...")
        self.sess_preprocess = onnxruntime.InferenceSession(
            str(self.preprocess_path), sess_options=session_opts, providers=["CPUExecutionProvider"]
        )
        print(">>> [OnnxEngine] [2/3] تحميل F5_Transformer.onnx...")
        self.sess_transformer = onnxruntime.InferenceSession(
            str(self.transformer_path), sess_options=session_opts, providers=["CPUExecutionProvider"]
        )
        print(">>> [OnnxEngine] [3/3] تحميل F5_Decode.onnx...")
        self.sess_decode = onnxruntime.InferenceSession(
            str(self.decode_path), sess_options=session_opts, providers=["CPUExecutionProvider"]
        )

        # استخراج معلومات المدخلات والمخرجات
        self.preprocess_inputs = tuple(self.sess_preprocess.get_inputs())
        self.preprocess_outputs = tuple(self.sess_preprocess.get_outputs())
        self.transformer_inputs = tuple(self.sess_transformer.get_inputs())
        self.transformer_outputs = tuple(self.sess_transformer.get_outputs())
        self.decode_inputs = tuple(self.sess_decode.get_inputs())
        self.decode_outputs = tuple(self.sess_decode.get_outputs())

        self.audio_input, self.text_input, self.duration_input = self.preprocess_inputs
        self.transformer_output, = self.transformer_outputs
        self.decode_output, = self.decode_outputs

        self.downstream_inputs = {
            arg.name: arg for arg in (*self.transformer_inputs, *self.decode_inputs)
        }

        self.initialized = True
        print(">>> [OnnxEngine] ✅ محرك ONNX جاهز بالكامل في الذاكرة!")

    def _diacritize_if_needed(self, text: str) -> str:
        """فحص النص وإضافة التشكيل إذا كان غير مشكّل ولديك نموذج تشكيل"""
        if not text:
            return text
        # فحص وجود حركات (الفتحة والضمة والكسرة والكسرتين وغيرها من U+064B إلى U+0652)
        has_harakat = any('\u064B' <= c <= '\u0652' for c in text)
        if has_harakat or not self.diacritizer:
            return text

        try:
            if hasattr(self.diacritizer, "predict"):
                return self.diacritizer.predict(text)
            elif hasattr(self.diacritizer, "diacritize"):
                return self.diacritizer.diacritize(text)
        except Exception as e:
            print(f">>> [OnnxEngine] تعذر تشكيل النص آلياً: {e}")
        return text

    def infer(
        self,
        ref_file: str,
        ref_text: str,
        gen_text: str,
        output_file: str,
        speed: float = 1.0,
        seed: Optional[int] = None,
    ) -> Tuple[int, int]:
        """
        تنفيذ الاستدلال السريع عبر خط أنابيب ONNX مع I/O Bindings.
        يعيد (infer_time_ms, sample_rate).
        """
        start_time = time.perf_counter()

        try:
            # 1. تجهيز الصوت المرجعي
            audio_segment = (
                AudioSegment.from_file(ref_file)
                .set_channels(1)
                .set_frame_rate(self.in_sample_rate)
                .set_sample_width(2)
            )
            audio_samples = np.asarray(audio_segment.get_array_of_samples())

            inv_int16 = float(1.0 / 32768.0)
            if np.issubdtype(numpy_dtype(self.audio_input), np.floating):
                audio = (audio_samples.astype(np.float32) * inv_int16).astype(numpy_dtype(self.audio_input))
            else:
                audio = audio_samples.astype(numpy_dtype(self.audio_input))
            audio_len = audio.size

            # 2. معالجة النصوص (إضافة تشكيل إن لزم الأمر)
            ref_text_processed = self._diacritize_if_needed(ref_text)
            gen_text_processed = self._diacritize_if_needed(gen_text)

            if len(ref_text_processed[-1].encode("utf-8")) == 1:
                ref_text_processed = ref_text_processed + " "

            local_speed = max(0.5, min(2.0, float(speed)))
            if len(gen_text_processed.encode("utf-8")) < 10:
                local_speed = 0.3

            ref_text_len = len(ref_text_processed.encode("utf-8"))
            gen_text_len = len(gen_text_processed.encode("utf-8"))

            model_audio_len = int(audio_len * self.sample_rate / self.in_sample_rate)
            ref_audio_len = model_audio_len // self.hop_length
            cond_signal_len = ref_audio_len + 1

            full_text = ref_text_processed + gen_text_processed
            text_chars = text_to_char_list(full_text)
            text_ids = list_str_to_idx(text_chars, self.vocab_map, numpy_dtype(self.text_input))

            duration = ref_audio_len + int(ref_audio_len / max(1, ref_text_len) * gen_text_len / local_speed)
            max_duration_value = max(max(text_ids.shape[-1], cond_signal_len) + 1, duration)

            if max_duration_value > self.max_signal_length:
                max_duration_value = self.max_signal_length

            symbols = {"max_duration": max_duration_value}
            audio_shape = resolve_shape(self.audio_input, symbols, (audio_len,))
            record_shape(self.audio_input, audio_shape, symbols)
            text_shape = resolve_from_shape(self.text_input, text_ids.shape, symbols)
            duration_shape = resolve_shape(self.duration_input, symbols)
            record_shape(self.duration_input, duration_shape, symbols)

            # 3. إعداد I/O Binding لمعالج الصوت F5_Preprocess
            preprocess_input_values = {
                self.audio_input.name: ortvalue_for(self.audio_input, audio, audio_shape, 'cpu'),
                self.text_input.name: ortvalue_for(self.text_input, text_ids, text_shape, 'cpu'),
                self.duration_input.name: ortvalue_for(self.duration_input, max_duration_value, duration_shape, 'cpu'),
            }
            preprocess_output_values = {}
            for arg in self.preprocess_outputs:
                downstream_in = self.downstream_inputs.get(arg.name)
                if downstream_in is None or not same_layout(arg, downstream_in):
                    raise ValueError(f"تعارض أبعاد لمخرج المعالجة الصوتية: {arg.name}")
                shp = resolve_shape(downstream_in, symbols)
                record_shape(arg, shp, symbols)
                preprocess_output_values[arg.name] = empty_ortvalue(arg, shp, 'cpu')

            binding_preprocess = self.sess_preprocess.io_binding()
            bind_inputs(binding_preprocess, self.preprocess_inputs, preprocess_input_values)
            bind_outputs(binding_preprocess, self.preprocess_outputs, preprocess_output_values)

            # تشغيل المرحلة 1: Preprocess
            self.sess_preprocess.run_with_iobinding(binding_preprocess, run_options=self.run_options)

            # 4. إعداد مدخلات F5_Transformer
            step_input, = (
                arg for arg in self.transformer_inputs
                if arg.name not in preprocess_output_values
            )
            state_input, = (
                arg for arg in self.transformer_inputs
                if arg.name in preprocess_output_values and same_layout(arg, self.transformer_output)
            )
            constant_inputs = tuple(
                arg for arg in self.transformer_inputs
                if arg.name not in (state_input.name, step_input.name)
            )

            state_source = preprocess_output_values[state_input.name]
            state_shape = resolve_from_shape(state_input, state_source.shape(), symbols)
            output_shape = resolve_from_shape(self.transformer_output, state_shape, symbols)

            state_buffers = (
                state_source,
                empty_ortvalue(self.transformer_output, output_shape, 'cpu'),
            )

            step_shape = resolve_shape(step_input, symbols)
            step_dtype = numpy_dtype(step_input)
            step_values = np.broadcast_to(
                np.arange(self.nfe_step, dtype=step_dtype).reshape(
                    (self.nfe_step,) + (1,) * len(step_shape)
                ),
                (self.nfe_step,) + step_shape,
            ).copy()

            step_buffers = tuple(
                ortvalue_for(step_input, step_values[st], step_shape, 'cpu')
                for st in range(self.nfe_step)
            )

            constant_values = {
                arg.name: preprocess_output_values[arg.name]
                for arg in constant_inputs
            }

            # رابطان متناوبان (Double Buffering) للتدوير السريع
            transformer_bindings = tuple(self.sess_transformer.io_binding() for _ in range(2))
            for idx, bind in enumerate(transformer_bindings):
                inp_vals = dict(constant_values)
                inp_vals[state_input.name] = state_buffers[idx]
                bind_inputs(bind, constant_inputs + (state_input,), inp_vals)
                bind_outputs(bind, self.transformer_outputs, {self.transformer_output.name: state_buffers[1 - idx]})

            # تشغيل المرحلة 2: Flow Matching Loop (16 خطوة سريعة)
            for st in range(self.nfe_step):
                binding = transformer_bindings[st & 1]
                binding.bind_ortvalue_input(step_input.name, step_buffers[st])
                self.sess_transformer.run_with_iobinding(binding, run_options=self.run_options)

            # 5. تشغيل المرحلة 3: F5_Decode (تحويل Mel إلى موجة صوتية عبر Vocos)
            noise_final = state_buffers[self.nfe_step & 1]
            decode_state_input, = (
                arg for arg in self.decode_inputs
                if arg.name not in preprocess_output_values
            )
            decode_input_values = {
                arg.name: preprocess_output_values[arg.name]
                for arg in self.decode_inputs
                if arg.name in preprocess_output_values
            }
            decode_input_values[decode_state_input.name] = noise_final

            binding_decode = self.sess_decode.io_binding()
            bind_inputs(binding_decode, self.decode_inputs, decode_input_values)

            try:
                decode_out_shape = resolve_shape(self.decode_output, symbols)
                generated_signal = empty_ortvalue(self.decode_output, decode_out_shape, 'cpu')
                binding_decode.bind_ortvalue_output(self.decode_output.name, generated_signal)
            except ValueError:
                generated_signal = None
                binding_decode._iobinding.bind_output(
                    self.decode_output.name,
                    C.OrtDevice(C.OrtDevice.cpu(), C.OrtDevice.default_memory(), 0)
                )

            self.sess_decode.run_with_iobinding(binding_decode, run_options=self.run_options)

            if generated_signal is None:
                generated_signal, = binding_decode.get_outputs()

            audio_data = generated_signal.numpy().reshape(-1)
            if np.issubdtype(audio_data.dtype, np.floating):
                audio_data = np.clip(audio_data, -1.0, 1.0)
                audio_out = (audio_data * 32767.0).astype(np.int16)
            else:
                audio_out = audio_data.astype(np.int16)

            os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)
            sf.write(
                output_file,
                audio_out,
                self.out_sample_rate,
                subtype="PCM_16",
                format="WAV",
            )

        except Exception as e:
            raise ModelInferenceError(f"خطأ أثناء استدلال نموذج ONNX: {str(e)}")

        end_time = time.perf_counter()
        infer_ms = int((end_time - start_time) * 1000)

        if not os.path.exists(output_file) or os.path.getsize(output_file) == 0:
            raise ModelInferenceError("النموذج لم يقم بإنشاء ملف صوتي صالح")

        self.is_cold_start = False
        return infer_ms, self.out_sample_rate
