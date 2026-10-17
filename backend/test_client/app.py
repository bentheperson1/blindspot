from flask import Flask

WS_URL = "ws://127.0.0.1:8000/images/stream"

app = Flask(__name__)

PAGE = """
<!doctype html>
<title>Webcam Test Client</title>
<style>
	body { font-family: sans-serif; margin: 20px; }
	.row { display: flex; gap: 16px; margin-bottom: 12px; }
	video, img { width: 480px; background: #111; border: 1px solid #ccc; }
	button { padding: 6px 12px; }
	.stats { font-size: 13px; color: #555; margin-left: 12px; }
</style>

<h2>Webcam to OpenCV</h2>

<div>
	<button id="btn_start">Start</button>
	<button id="btn_stop" disabled>Stop</button>
	<label style="margin-left: 12px">JPEG quality
		<input id="quality" type="range" min="0.3" max="1" step="0.1" value="0.8">
	</label>
	<span class="stats" id="stats">idle</span>
</div>

<div class="row">
	<div>
		<div>Original</div>
		<video id="video" autoplay playsinline muted></video>
	</div>
	<div>
		<div>Processed</div>
		<img id="result">
	</div>
</div>

<canvas id="capture" style="display:none"></canvas>

<script>
const WS_URL = "__WS_URL__";

const video = document.getElementById("video");
const result = document.getElementById("result");
const capture = document.getElementById("capture");
const stats = document.getElementById("stats");
const quality = document.getElementById("quality");
const btn_start = document.getElementById("btn_start");
const btn_stop = document.getElementById("btn_stop");

let stream = null;
let ws = null;
let running = false;

let frame_count = 0;
let last_fps_time = performance.now();
let last_send_time = 0;
let latency_ms = 0;

async function start() {
	stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
	video.srcObject = stream;

	running = true;
	btn_start.disabled = true;
	btn_stop.disabled = false;

	ws = new WebSocket(WS_URL);
	ws.onopen = () => {
		stats.textContent = "connected";
		send_frame();
	};
	ws.onmessage = handle_message;
	ws.onclose = () => {
		stats.textContent = "disconnected";
		stop();
	};
	ws.onerror = () => {
		stats.textContent = "websocket error (is FastAPI running?)";
	};
}

function stop() {
	running = false;
	btn_start.disabled = false;
	btn_stop.disabled = true;

	if (ws) {
		ws.onclose = null;
		ws.close();
		ws = null;
	}

	if (stream) {
		stream.getTracks().forEach((t) => t.stop());
		stream = null;
	}
}

function send_frame() {
	if (!running || !ws || ws.readyState !== WebSocket.OPEN) {
		return;
	}

	// Wait until the camera has produced a real frame
	if (video.readyState < 2 || video.videoWidth === 0) {
		setTimeout(send_frame, 50);
		return;
	}

	capture.width = video.videoWidth;
	capture.height = video.videoHeight;
	capture.getContext("2d").drawImage(video, 0, 0);

	capture.toBlob((blob) => {
		if (!running || !ws || ws.readyState !== WebSocket.OPEN) {
			return;
		}

		last_send_time = performance.now();
		ws.send(blob);
	}, "image/jpeg", parseFloat(quality.value));
}

function handle_message(event) {
	latency_ms = Math.round(performance.now() - last_send_time);

	if (typeof event.data === "string") {
		stats.textContent = `server: ${event.data}`;
	} else {
		const old_url = result.src;
		result.src = URL.createObjectURL(event.data);

		if (old_url.startsWith("blob:")) {
			URL.revokeObjectURL(old_url);
		}

		frame_count++;
	}

	const now = performance.now();

	if (now - last_fps_time >= 1000) {
		const fps = (frame_count * 1000) / (now - last_fps_time);
		stats.textContent = `${fps.toFixed(1)} fps | ${latency_ms} ms round trip`;
		frame_count = 0;
		last_fps_time = now;
	}

	// Only send the next frame once the previous one came back, so nothing queues up
	send_frame();
}

btn_start.onclick = start;
btn_stop.onclick = stop;
</script>
"""


@app.route("/")
def index():
	return PAGE.replace("__WS_URL__", WS_URL)


if __name__ == "__main__":
	app.run(port=5000, debug=True)