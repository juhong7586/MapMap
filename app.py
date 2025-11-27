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
    polygons = detect_polygons_from_cv_image(img)
    return polygons, "Success"


def detect_polygons_from_cv_image(img):
    """Improved polygon detection for document-like shapes.

    Uses edge detection + contour approximation, filters by area and aspect,
    and returns polygons sorted by area (largest first). Prioritizes quadrilaterals.
    """
    try:
        # Convert to gray and reduce noise while preserving edges
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray = cv2.bilateralFilter(gray, 9, 75, 75)

        # Use adaptive threshold or Canny depending on lighting
        # Try Canny edge detection for crisper document edges
        edges = cv2.Canny(gray, 50, 150)

        # Dilate edges to close gaps
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5,5))
        edges = cv2.dilate(edges, kernel, iterations=1)

        # Find contours on the edges
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        candidates = []
        h_img, w_img = img.shape[:2]
        img_area = w_img * h_img

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 1000:  # ignore tiny contours
                continue

            # Approximate contour
            peri = cv2.arcLength(cnt, True)
            epsilon = max(0.01 * peri, 2.0)
            approx = cv2.approxPolyDP(cnt, epsilon, True)
            if approx is None or len(approx) < 3:
                continue

            # bounding box and aspect heuristics
            x, y, w, h = cv2.boundingRect(approx)
            if w < 20 or h < 20:
                continue

            rect_area = w * h
            # discard extremely thin or large-area (noise) shapes
            if rect_area < 500 or rect_area > img_area * 0.98:
                # allow large area only if approx has 4 vertices
                if len(approx) != 4:
                    continue

            points = approx.reshape(-1, 2).tolist()

            candidates.append({
                'points': points,
                'area': float(area),
                'vertices': len(points),
                'bbox': { 'x': int(x), 'y': int(y), 'width': int(w), 'height': int(h) }
            })

        # sort candidates: prefer quadrilaterals then by area
        quads = [c for c in candidates if c['vertices'] == 4]
        others = [c for c in candidates if c['vertices'] != 4]
        quads.sort(key=lambda x: -x['area'])
        others.sort(key=lambda x: -x['area'])
        polygons = quads + others
        return polygons
    except Exception:
        return []


def encode_image_to_dataurl(img, quality=92):
    # img expected in BGR (OpenCV) format
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)]
    success, buf = cv2.imencode('.jpg', img, encode_param)
    if not success:
        raise RuntimeError('Failed to encode image')
    b64 = base64.b64encode(buf.tobytes()).decode('ascii')
    return f'data:image/jpeg;base64,{b64}'


def order_points_clockwise(pts):
    arr = np.array(pts, dtype='float32')
    rect = np.zeros((4,2), dtype='float32')
    s = arr.sum(axis=1)
    rect[0] = arr[np.argmin(s)]
    rect[2] = arr[np.argmax(s)]
    diff = np.diff(arr, axis=1)
    rect[1] = arr[np.argmin(diff)]
    rect[3] = arr[np.argmax(diff)]
    return rect


@app.route('/crop-and-detect', methods=['POST'])
def crop_and_detect():
    try:
        payload = request.get_json()
        if not payload or 'image' not in payload or 'polygon' not in payload:
            return jsonify(success=False, error='Missing image or polygon'), 400

        # decode base64 image
        base64_str = payload['image']
        if base64_str.startswith('data:'):
            base64_str = base64_str.split(',', 1)[1]
        img_bytes = base64.b64decode(base64_str)
        arr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return jsonify(success=False, error='Could not decode image'), 400

        h_img, w_img = img.shape[:2]
        pts = np.array(payload['polygon'], dtype='float32')
        if payload.get('normalized'):
            pts[:,0] *= w_img
            pts[:,1] *= h_img

        if pts.shape[0] != 4:
            return jsonify(success=False, error='polygon must have 4 points'), 400

        src = order_points_clockwise(pts)

        # compute output size from polygon aspect
        widthA = np.linalg.norm(src[2] - src[3])
        widthB = np.linalg.norm(src[1] - src[0])
        maxWidth = max(int(widthA), int(widthB))
        heightA = np.linalg.norm(src[1] - src[2])
        heightB = np.linalg.norm(src[0] - src[3])
        maxHeight = max(int(heightA), int(heightB))

        MAX_DIM = 2500
        maxWidth = max(1, min(maxWidth, MAX_DIM))
        maxHeight = max(1, min(maxHeight, MAX_DIM))

        dst = np.array([[0,0], [maxWidth-1,0], [maxWidth-1,maxHeight-1], [0,maxHeight-1]], dtype='float32')

        M = cv2.getPerspectiveTransform(src, dst)
        warped = cv2.warpPerspective(img, M, (maxWidth, maxHeight), flags=cv2.INTER_LINEAR)

        out_dataurl = encode_image_to_dataurl(warped, quality=92)

        result = {'success': True, 'cropped_image': out_dataurl}

        if payload.get('detect_inner'):
            try:
                polygons = detect_polygons_from_cv_image(warped)
                result['polygons'] = polygons
            except Exception as e:
                result['polygons_error'] = str(e)

        return jsonify(result)
    except Exception as e:
        return jsonify(success=False, error=str(e)), 500

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



@app.route('/match', methods=['GET'])
def serve_match():
    try:
        return send_from_directory(app.root_path, 'match.html')
    except Exception:
        return jsonify({"error": "match.html not found"}), 404

@app.route('/', methods=['GET'])
def serve_index():
    try:
        # Serve the intro page at the root by default
        return send_from_directory(app.root_path, 'intro.html')
    except Exception:
        return jsonify({"error": "index.html not found"}), 404


@app.route('/map.html', methods=['GET'])
def serve_map_html():
    try:
        return send_from_directory(app.root_path, 'map.html')
    except Exception:
        return jsonify({"error": "map.html not found"}), 404


@app.route('/make_map.html', methods=['GET'])
def serve_make_map():
    try:
        return send_from_directory(app.root_path, 'make_map.html')
    except Exception:
        return jsonify({"error": "make_map.html not found"}), 404


if __name__ == '__main__':
    app.run(debug=True, port=5000)