from app import app
from flask import render_template, request, jsonify
import requests
import json
from config import API_BASE_URL


# ======================
# HOME PAGE
# ======================
@app.route('/')
def index():
    try:
        response = requests.get(f"{API_BASE_URL}/cars", timeout=10)
        data = response.json()
        cars = data.get("data", []) if data.get("status") == 1 else []
    except Exception as e:
        print("HOME API ERROR:", e)
        cars = []

    return render_template('index.html', cars=cars)



# ======================
# LOGIN / REGISTER (MOBILE + PASSWORD)
# ======================
@app.route('/login', methods=['POST'])
def login():
    try:
        payload = request.get_json()

        if not payload:
            return jsonify({
                "status": 0,
                "message": "Invalid request data"
            }), 400

        mobile = payload.get("mobile")
        password = payload.get("password")

        if not mobile or not password:
            return jsonify({
                "status": 0,
                "message": "Mobile and password are required"
            }), 422

        # 🔥 Laravel API call
        response = requests.post(
            f"{API_BASE_URL}/loginOrRegister",
            json={
                "mobile": mobile,
                "password": password
            },
            timeout=10
        )

        try:
            data = response.json()
        except ValueError:
            print("LOGIN API ERROR: non-json response", response.status_code, response.text)
            return jsonify({"status": 0, "message": "Invalid response from auth API"}), 502

        return jsonify(data), response.status_code

    except Exception as e:
        print("LOGIN API ERROR:", e)
        return jsonify({
            "status": 0,
            "message": "Login failed"
        }), 500




# ======================
# CAR DETAIL PAGE
# ======================
@app.route('/car-rental/<int:car_id>')
def car_detail(car_id):

    # 👉 Your backend WORKING API is POST /carDetails
    api_url = f"{API_BASE_URL}/carDetails"

    try:
        response = requests.post(api_url, json={"car_id": car_id}, timeout=10)
        data = response.json()

        if data.get("status") != 1 or not data.get("data"):
            return render_template(
                'car_rental/car_detail.html',
                car=None,
                error="Car not found."
            ), 404

        car = data["data"]

    except Exception as e:
        print("CAR DETAIL API ERROR:", e)
        return render_template(
            'car_rental/car_detail.html',
            car=None,
            error="Failed to load car details."
        ), 502

    # ======================
    # 🔥 JSON STRING → PYTHON OBJECT (IMPORTANT)
    # ======================
    def safe_json(value, default):
        try:
            if isinstance(value, str):
                return json.loads(value)
            return value if value is not None else default
        except Exception:
            return default

    car["booking_includes"] = safe_json(car.get("booking_includes"), [])
    car["why_book_us"] = safe_json(car.get("why_book_us"), [])
    car["trip_policies"] = safe_json(car.get("trip_policies"), [])
    car["recent_reviews"] = safe_json(car.get("recent_reviews"), [])

    # ======================
    # NORMALIZE SIMPLE FIELDS
    # ======================
    car["is_ac"] = int(car.get("is_ac", 0))
    car["rating_value"] = float(car.get("rating_value", 0))
    car["rating_count"] = int(car.get("rating_count", 0))
    car["min_trip_amount"] = float(car.get("min_trip_amount", 0))

    # ✅ NO MEDIA_BASE_URL
    # API already gives full image URL
    # car["car_photos"] stays as-is

    return render_template(
        'car_rental/car_detail.html',
        car=car
    )


# ======================
# 404 PAGE
# ======================
@app.errorhandler(404)
def not_found(e):
    return render_template('404.html'), 404
