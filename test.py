from transformers import AutoModelForCausalLM, AutoTokenizer
from PIL import Image

model = AutoModelForCausalLM.from_pretrained(
    "vikhyatk/moondream2",
    revision="2025-06-21",
    trust_remote_code=True,
    device_map={"": "cuda"}  # ...or 'mps', on Apple Silicon
)

# Captioning
print("Short caption:")
print(model.caption(image, length="short")["caption"])

print("\nNormal caption:")
for t in model.caption(image, length="normal", stream=True)["caption"]:
    # Streaming generation example, supported for caption() and detect()
    print(t, end="", flush=True)
print(model.caption(image, length="normal"))

# Visual Querying
print("\nVisual query: 'How many people are in the image?'")
print(model.query(image, "How many people are in the image?")["answer"])

# Object Detection
print("\nObject detection: 'face'")
objects = model.detect(image, "face")["objects"]
print(f"Found {len(objects)} face(s)")

# Pointing
print("\nPointing: 'person'")
points = model.point(image, "person")["points"]
print(f"Found {len(points)} person(s)")
