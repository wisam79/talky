import json
import base64

def analyze():
    try:
        # Try different encodings
        content = None
        for enc in ['utf-8-sig', 'utf-16', 'utf-8']:
            try:
                with open('gradio_config.json', 'r', encoding=enc) as f:
                    content = f.read()
                config = json.loads(content)
                print(f"Loaded with {enc}")
                break
            except:
                continue
        
        if not content:
            print("Failed to decode JSON with standard encodings.")
            return

        # Find the dependency that outputs to Audio
        audio_ids = [c['id'] for c in config['components'] if c.get('type') == 'audio']
        
        # We look for the main generate function
        # For OmniVoice, it's typically the first one or the one with most inputs
        main_dep = config['dependencies'][0]
        
        print(f"Endpoint Index: 0")
        print(f"Inputs count: {len(main_dep['inputs'])}")
        
        comps = {c['id']: c for c in config['components']}
        
        for i, cid in enumerate(main_dep['inputs']):
            c = comps.get(cid)
            if not c:
                print(f"{i}: Component {cid} not found")
                continue
            
            label = c.get('props', {}).get('label')
            ctype = c.get('type')
            props = c.get('props', {})
            
            info = f"{i}: [{ctype}] Label: {label}"
            if ctype == 'slider':
                info += f" | min: {props.get('minimum')}, max: {props.get('maximum')}, def: {props.get('value')}"
            elif ctype == 'dropdown':
                info += f" | choices: {props.get('choices')[:5]}"
            
            print(info)
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    analyze()
