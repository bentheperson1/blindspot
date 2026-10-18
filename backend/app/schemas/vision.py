from pydantic import BaseModel, Field

class ImageInfo(BaseModel):
    width: int
    height: int
    channels: int

class Location(BaseModel):
    latitude: float
    longitude: float
    altitude: float | None = None
    accuracy: float | None = None  # meters; Expo can report null
    altitudeAccuracy: float | None = None
    heading: float | None = None  # course of travel, -1 or null when not moving
    speed: float | None = None


class Compass(BaseModel):
    magHeading: float
    trueHeading: float | None = None  # -1 (iOS) or null when unavailable
    accuracy: float | None = None  # calibration level 0-3, not degrees

class Vec3(BaseModel):
    x: float
    y: float
    z: float
    timestamp: float | None = None


class Euler(BaseModel):
    alpha: float
    beta: float
    gamma: float
    timestamp: float | None = None


class Motion(BaseModel):
    rotation: Euler | None = None
    rotationRate: Euler | None = None
    acceleration: Vec3 | None = None
    accelerationIncludingGravity: Vec3 | None = None
    orientation: int = 0  # screen orientation
    interval: float | None = None  # ms between motion samples


class Settings(BaseModel):
    radius_m: float = Field(default=1609, gt=0)
    mode: str = "pedestrian"

class Base64ImageRequest(BaseModel):
    image: str

class Telemetry(BaseModel):
    ts: int
    monotonic_ms: float
    location: Location | None = None
    locationTimestamp: int | None = None
    compass: Compass | None = None
    motion: Motion | None = None
    magnetometer: Vec3 | None = None

class Dot(BaseModel):
    name: str
    x: float  # normalized 0–1 within the camera frame
    y: float
    distance_to_user: float

class Base64ImageResponse(BaseModel):
    telemetry: Telemetry | None = None
    dots: list[Dot] = []


class ClassifyRequest(BaseModel):
    """A user-submitted report: one photo of a suspected camera plus where they were standing."""
    image: str  # base64 jpeg
    lat: float | None = None
    lon: float | None = None
    gps_accuracy: float | None = None  # meters


class ClassifyResponse(BaseModel):
    """The model's verdict on whether the photo shows a Flock camera."""
    is_flock: bool
    camera_type: str  # e.g. "Flock Safety Falcon", "Traffic camera", "Unknown"
    confidence: float  # 0–1
    message: str | None = None


class FlockCamera(BaseModel):
    name: str
    latitude: float
    longitude: float
    heading: int


class InputInfo(BaseModel):
    lat_p: float
    lon_p: float
    alpha: float
    beta: float
    gamma: float
    compass_heading: float
    screen_w: float
    screen_h: float
    hfov: float


class LocationInputInfo(InputInfo):
    radius: float


class UserMessage(BaseModel):
    camera_width: int
    camera_height: int

    ts: int  # unix ms, client clock
    monotonic_ms: float

    location: Location | None = None
    locationTimestamp: int | None = None

    compass: Compass | None = None
    motion: Motion | None = None
    magnetometer: Vec3 | None = None

    settings: Settings
    flock_cameras: list[FlockCamera] | None = None
    radius_m: float | None = None  # optional override of settings.radius_m
