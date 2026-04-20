# HuggingFace Space entry point - serves static files ONLY
# The actual API backend runs on Render.com
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import uvicorn
import os

app = FastAPI()
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run("app_hf:app", host="0.0.0.0", port=7860)
