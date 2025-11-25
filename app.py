from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import cv2
import numpy as np
import base64
from io import BytesIO
from PIL import Image

app = Flask(__name__)
# Development: make CORS permissive to avoid origin issues while testing locally.
# NOTE: This should be restricted or removed in production.
CORS(app)

def detect_polygons(image_path):
    """
    Detect polygons from an image using OpenCV
    Returns list of polygons with their properties
    """
    img = cv2.imread(image_path)
    if img is None:
        return None, "Could not read image"
    
    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Apply blur to reduce noise
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Apply threshold
    _, thresh = cv2.threshold(blurred, 127, 255, cv2.THRESH_BINARY)
    
    # Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    
    polygons = []
    
    for contour in contours:
        # Filter small contours
        area = cv2.contourArea(contour)
        if area < 500:
            continue
        
        # Approximate contour to polygon
        epsilon = 0.02 * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        
        # Get bounding rectangle
        x, y, w, h = cv2.boundingRect(approx)
        
        # Convert points to list format
        points = approx.reshape(-1, 2).tolist()
        
        polygon = {
            "points": points,
            "area": float(area),
            "vertices": len(points),
            "bbox": {
                "x": int(x),
                "y": int(y),
                "width": int(w),
                "height": int(h)
            }
        }
        
        polygons.append(polygon)
    
    return polygons, "Success"

@app.route('/upload', methods=['POST'])
def upload_image():
    """
    Handle image upload and detect polygons
    """
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file part"}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({"error": "No selected file"}), 400
        
        # Save temporarily
        img_path = f"/tmp/{file.filename}"
        file.save(img_path)
        
        # Detect polygons
        polygons, message = detect_polygons(img_path)
        
        if polygons is None:
            return jsonify({"error": message}), 400
        
        return jsonify({
            "success": True,
            "message": f"Detected {len(polygons)} polygons",
            "polygons": polygons
        }), 200
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/upload-base64', methods=['POST'])
def upload_base64():
    """
    Handle base64 encoded image from webcam
    """
    try:
        data = request.json
        base64_str = data.get('image')
        
        if not base64_str:
            return jsonify({"error": "No image data"}), 400
        
        # Decode base64
        img_data = base64.b64decode(base64_str.split(',')[1])
        img = Image.open(BytesIO(img_data))
        
        # Convert to OpenCV format
        cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        
        # Save temporarily
        img_path = "/tmp/webcam_image.jpg"
        cv2.imwrite(img_path, cv_img)
        
        # Detect polygons
        polygons, message = detect_polygons(img_path)
        
        if polygons is None:
            return jsonify({"error": message}), 400
        
        return jsonify({
            "success": True,
            "message": f"Detected {len(polygons)} polygons",
            "polygons": polygons
        }), 200
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "Backend is running"}), 200


@app.route('/', methods=['GET'])
def serve_index():
    try:
        # Serve the intro page at the root by default
        return send_from_directory('.', 'intro.html')
    except Exception:
        return jsonify({"error": "index.html not found"}), 404


@app.route('/index.html', methods=['GET'])
def serve_index_html():
    try:
        return send_from_directory('.', 'index.html')
    except Exception:
        return jsonify({"error": "index.html not found"}), 404


@app.route('/intro', methods=['GET'])
def serve_intro():
    try:
        return send_from_directory('.', 'intro.html')
    except Exception:
        return jsonify({"error": "intro.html not found"}), 404

if __name__ == '__main__':
    app.run(debug=True, port=5000)