import asyncio
import websockets


async def main():
	url = "wss://148-100-79-51.sslip.io/images/stream"
	headers = {"x-api-key": "YOUR_KEY"}
	
	async with websockets.connect(url, additional_headers=headers) as ws:
		await ws.send(b"junk")
		print(await ws.recv())


asyncio.run(main())