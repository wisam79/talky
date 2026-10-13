import json

def analyze_config():
    try:
        with open('gradio_config.json', 'rb') as f:
            data = f.read()
        config = json.loads(data.decode('utf-16'))
        
        # Find the main inference dependency
        # Usually it's the one that takes most inputs or is triggered by the submit button
        # Let's look for dependencies that output to an Audio component
        audio_ids = [c['id'] for c in config['components'] if c.get('type') == 'audio']
        
        main_dep = None
        for dep in config['dependencies']:
            if any(out_id in audio_ids for out_id in dep['outputs']):
                main_dep = dep
                break
        
        if not main_dep:
            print("Could not find main audio dependency.")
            return

        print(f"Main Dependency Inputs Count: {len(main_dep['inputs'])}")
        print(f"Main Dependency Index: {config['dependencies'].index(main_dep)}")
        
        comps = {c['id']: c for c in config['components']}
        
        for i, in_id in enumerate(main_dep['inputs']):
            comp = comps.get(in_id)
            if not comp:
                print(f"Arg {i}: ID {in_id} - NOT FOUND")
                continue
                
            ctype = comp.get('type')
            label = comp.get('props', {}).get('label')
            props = comp.get('props', {})
            
            info = f"Arg {i}: {ctype} - Label: {label}"
            if ctype == 'slider':
                info += f" | Range: [{props.get('minimum')}, {props.get('maximum')}] | Default: {props.get('value')}"
            elif ctype == 'dropdown':
                info += f" | Choices: {props.get('choices')[:5]}..."
            elif ctype == 'number':
                info += f" | Default: {props.get('value')}"
            
            print(info)

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    analyze_config()
