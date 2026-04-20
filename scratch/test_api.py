import requests

def test_generate():
    url = "http://localhost:7860/api/generate"
    data = {
        "text": "Hello world",
        "language": "English",
        "role": "Auto",
        "gender": "Auto",
        "accent": "Auto",
        "dialect": "Auto",
        "ref_text": "",
        "seed": 0
    }
    try:
        print("Sending request to proxy...")
        response = requests.post(url, data=data, timeout=60)
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            print("Success! Audio generated.")
            with open("test_output.wav", "wb") as f:
                f.write(response.content)
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Connection error: {e}")

if __name__ == "__main__":
    test_generate()
