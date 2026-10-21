import os
from pathlib import Path

from dotenv import load_dotenv
from google import genai

env_path = Path(__file__).with_name(".env")
if not load_dotenv(env_path):
    raise SystemExit(f"Could not load environment file: {env_path}")

api_key = os.getenv("GEMINI_KEY", "").strip()
if not api_key:
    raise SystemExit(
        f"GEMINI_KEY is missing from {env_path}. "
        "Add your Gemini API key using GEMINI_KEY=..."
    )

client = genai.Client(api_key=api_key)

print("Pinging Gemini...")
response = client.models.generate_content(
    model="gemini-3.8-flash",
    contents="Say 'TrustMilestone AI is connected and ready!'",
)
print(response.text)