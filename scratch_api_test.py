import requests
import json

FLASK_URL = "http://127.0.0.1:5000/calculate-charges"

payload = {
    "car_id": 6,
    "distance_km": 50,
    "trip_type": "one_way",
    "stay_duration": "short",
    "waiting_minutes": 0,
    "is_ac": True
}

try:
    response = requests.post(FLASK_URL, json=payload, timeout=10)
    print(f"Status: {response.status_code}")
    print(json.dumps(response.json(), indent=2))
except Exception as e:
    print(f"Error: {e}")
