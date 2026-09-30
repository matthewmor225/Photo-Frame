MY PHOTO FRAME

IMPORTANT:
Open the website from an HTTPS web address (for example GitHub Pages).
Do NOT just double-click frame.html or sender.html and expect the internet
pairing to work reliably.

The app uses PeerJS for signaling/WebRTC. PeerJS Cloud currently uses
0.peerjs.com on port 443. The frame first connects to that service, then
the sender connects to the frame.

HOW TO USE:
1. Upload all files to your web host.
2. Open frame.html on the frame device.
3. Wait until it says "Online — waiting for photos."
4. Enter the 6-digit code into sender.html on your phone/PC.
5. Click Connect.
6. Choose photos and click Send Photos.

If a network blocks WebRTC/STUN, a TURN server may be required for that
network/device combination.
