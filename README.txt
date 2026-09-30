MY PHOTO FRAME - IMAGE FIXED

This build fixes the broken-image slideshow problem.

What changed:
- Image transfer uses PeerJS binary mode instead of JSON for photo chunks.
- Photo chunks are sent as real Blob data.
- The frame validates each received image before adding it.
- Old test photos are stored in a new v2 browser database so corrupted
  photos from earlier builds do not get loaded into the slideshow.
- The 3/8/15/30 second slideshow setting still works.
- Received photos are saved on the frame device.

IMPORTANT:
Use the website over HTTPS (for example GitHub Pages). Do not rely on
double-clicking the HTML files for internet pairing.

After updating:
1. Open the new frame.html.
2. It will have the same frame pairing code when possible.
3. Send the photos again.
