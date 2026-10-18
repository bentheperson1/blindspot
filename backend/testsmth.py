from pydantic import ValidationError
from app.services import camera_store as cs
from app.schemas.vision import FlockCamera

print("collections:", [c.id for c in cs._db.collections()])
docs = list(cs._db.collection("flock_cameras").limit(3).stream())
print("docs in flock_cameras:", len(docs))
for d in docs:
    data = d.to_dict()
    print("\n", d.id, data)
    try:
        FlockCamera.model_validate(data)
        print("  OK")
    except ValidationError as e:
        for err in e.errors():
            print("  FAILS:", err["loc"], "-", err["msg"])