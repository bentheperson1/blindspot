from pydantic import BaseModel, Field

class ImageInfo(BaseModel):
    width: int
    height: int
    channels: int


class Base64ImageRequest(BaseModel):
    image: str


class Base64ImageResponse(BaseModel):
    image: str

class Location(BaseModel):
    latitude: float
    longitude: float
    altitude: float | None = None
    accuracy: float  # meters
    altitudeAccuracy: float | None = None
    heading: float | None = None  # course of travel, -1 or null when not moving
    speed: float | None = None


class Compass(BaseModel):
    magHeading: float
    trueHeading: float | None = None  # null if the device can't compute it
    accuracy: float  # degrees


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


class UserMessage(BaseModel):
    image: str  # base64 JPEG
    width: int
    height: int
    camera_width: int
    camera_height: int

    ts: int  # unix ms, client clock
    monotonic_ms: float

    location: Location
    locationTimestamp: int  # unix ms of the GPS fix

    compass: Compass
    motion: Motion | None = None
    magnetometer: Vec3 | None = None

    settings: Settings
    
class FlockCamera(BaseModel):
    name: str
    latitude: float
    longitude: float
    heading: int