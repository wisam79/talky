from gradio_client import Client
import json

def get_signature():
    client = Client('k2-fsa/OmniVoice')
    config = client.config
    
    # Endpoints
    print(f"Total Endpoints: {len(client.endpoints)}")
    
    # Main inference (index 0 usually)
    dep = config['dependencies'][0]
    inputs = dep['inputs']
    comps = {c['id']: c for c in config['components']}
    
    print(f"Inference Endpoint (Index 0) Inputs:")
    for i, cid in enumerate(inputs):
        c = comps[cid]
        label = c.get('props', {}).get('label', 'No Label')
        ctype = c.get('type', 'Unknown')
        props = c.get('props', {})
        val = props.get('value')
        
        info = f"Arg {i}: [{ctype}] Label: {label} | Default: {val}"
        if ctype == 'slider':
            info += f" | Range: [{props.get('minimum')}, {props.get('maximum')}]"
        elif ctype == 'dropdown':
            info += f" | Choices: {props.get('choices')[:5]}..."
            
        print(info)

if __name__ == "__main__":
    get_signature()
