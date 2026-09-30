const $ = id => document.getElementById(id);

const PEER_OPTIONS = {
  host: "0.peerjs.com",
  port: 443,
  path: "/",
  secure: true,
  debug: 0
};

/* =========================
   SENDER
   ========================= */
if ($("files")) {
  let conn = null;
  let peer = null;
  let selected = [];

  $("files").onchange = () => {
    selected = [...$("files").files];
    $("preview").innerHTML = "";

    selected.forEach(file => {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.style.cssText =
        "width:90px;height:70px;object-fit:cover;margin:4px;border-radius:8px";
      $("preview").appendChild(img);
    });
  };

  $("connect").onclick = () => {
    const code = $("code").value.trim();

    if (!/^\d{6}$/.test(code)) {
      $("status").textContent = "Enter the 6-digit code from the frame.";
      return;
    }

    if (peer) {
      try { peer.destroy(); } catch (_) {}
    }

    $("status").textContent = "Connecting to frame…";
    peer = new Peer(undefined, PEER_OPTIONS);

    peer.on("open", () => {
      $("status").textContent = "Connecting to your frame…";

      conn = peer.connect("frame-" + code, {
        reliable: true,
        // IMPORTANT: binary mode keeps image data intact.
        serialization: "binary"
      });

      const timeout = setTimeout(() => {
        if (!conn || !conn.open) {
          $("status").textContent =
            "❌ Couldn't connect. Check the code and make sure the frame says Online.";
        }
      }, 10000);

      conn.on("open", () => {
        clearTimeout(timeout);
        $("status").textContent = "✅ Connected to frame.";
      });

      conn.on("close", () => {
        $("status").textContent = "Frame connection closed.";
      });

      conn.on("error", err => {
        clearTimeout(timeout);
        $("status").textContent =
          "❌ Connection error: " + (err.message || "unknown error");
      });
    });

    peer.on("error", err => {
      const type = err?.type || "unknown";

      if (type === "peer-unavailable") {
        $("status").textContent =
          "❌ Frame not found. Check the 6-digit code.";
      } else {
        $("status").textContent =
          "❌ Connection error: " + (err.message || type);
      }
    });
  };

  $("send").onclick = async () => {
    if (!conn || !conn.open) {
      $("status").textContent = "Connect to the frame first.";
      return;
    }

    if (!selected.length) {
      $("status").textContent = "Choose at least one photo first.";
      return;
    }

    try {
      for (let n = 0; n < selected.length; n++) {
        const file = selected[n];

        if (!file.type.startsWith("image/")) continue;

        if (file.size > 25 * 1024 * 1024) {
          $("status").textContent =
            `Skipped ${file.name}: maximum size is 25 MB.`;
          continue;
        }

        $("status").textContent =
          `Sending ${n + 1} of ${selected.length}: ${file.name}`;

        const blob = file;
        const id = crypto.randomUUID();
        const chunkSize = 48 * 1024;

        conn.send({
          type: "start",
          id,
          name: file.name,
          mime: file.type,
          size: file.size
        });

        // Send actual Blob chunks in binary mode.
        for (let offset = 0; offset < blob.size; offset += chunkSize) {
          const chunk = blob.slice(offset, Math.min(offset + chunkSize, blob.size));

          conn.send({
            type: "chunk",
            id,
            data: chunk
          });

          // Avoid filling the WebRTC send buffer too quickly.
          while (conn.bufferSize && conn.bufferSize > 4 * 1024 * 1024) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
        }

        conn.send({
          type: "end",
          id
        });
      }

      $("status").textContent = "✅ All photos sent.";
    } catch (err) {
      $("status").textContent =
        "❌ Send failed: " + (err.message || "unknown error");
    }
  };
}

/* =========================
   SETTINGS
   ========================= */
if ($("speed") && !$("photo")) {
  const saved = localStorage.getItem("myPhotoFrameSpeed");

  if (["3000", "8000", "15000", "30000"].includes(saved)) {
    $("speed").value =
      saved === "3000" ? "3 seconds" :
      saved === "8000" ? "8 seconds" :
      saved === "15000" ? "15 seconds" :
      "30 seconds";
  }

  $("speed").addEventListener("change", () => {
    const value =
      $("speed").value === "3 seconds" ? "3000" :
      $("speed").value === "8 seconds" ? "8000" :
      $("speed").value === "15 seconds" ? "15000" :
      "30000";

    localStorage.setItem("myPhotoFrameSpeed", value);

    if ($("savedMsg")) {
      $("savedMsg").textContent = "✅ Saved on this device.";
    }
  });
}

/* =========================
   FRAME
   ========================= */
if ($("code") && $("photo")) {
  // Version 2 prevents old/corrupted photos from the earlier test build
  // from being loaded again.
  const DB_NAME = "myPhotoFrameDB_v2";
  const STORE = "photos";

  let code = localStorage.getItem("myPhotoFrameCode");

  if (!code || !/^\d{6}$/.test(code)) {
    code = String(Math.floor(100000 + Math.random() * 900000));
    localStorage.setItem("myPhotoFrameCode", code);
  }

  $("code").textContent = code;

  let peer = null;
  let photos = [];
  let index = 0;
  let timer = null;
  let slideSpeed = Number(
    localStorage.getItem("myPhotoFrameSpeed") || "8000"
  );

  function setStatus(message) {
    if ($("status")) $("status").textContent = message;
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, {
            keyPath: "id",
            autoIncrement: true
          });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function savePhoto(name, mime, blob) {
    const db = await openDB();

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");

      tx.objectStore(STORE).add({
        name,
        mime,
        blob,
        created: Date.now()
      });

      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadSavedPhotos() {
    try {
      const db = await openDB();

      const rows = await new Promise((resolve, reject) => {
        const req = db
          .transaction(STORE, "readonly")
          .objectStore(STORE)
          .getAll();

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      // Validate every saved image before putting it into the slideshow.
      for (const row of rows) {
        const url = URL.createObjectURL(row.blob);
        const image = new Image();

        const valid = await new Promise(resolve => {
          image.onload = () => resolve(true);
          image.onerror = () => resolve(false);
          image.src = url;
        });

        if (valid) {
          photos.push({
            url,
            name: row.name
          });
        } else {
          URL.revokeObjectURL(url);
        }
      }

      if (photos.length) {
        index = 0;
        show(true);
      }
    } catch (err) {
      console.warn("Could not restore saved photos:", err);
    }
  }

  function show(startTimer = true) {
    if (!photos.length) return;

    $("setup").style.display = "none";
    $("viewer").style.display = "grid";

    $("photo").src = photos[index].url;
    $("bar").textContent =
      `${index + 1} / ${photos.length} — ${photos[index].name}`;

    clearTimeout(timer);

    if (startTimer && photos.length > 1) {
      timer = setTimeout(() => {
        index = (index + 1) % photos.length;
        show(true);
      }, slideSpeed);
    }
  }

  function startPeer() {
    setStatus("Connecting to internet connection server…");

    peer = new Peer("frame-" + code, PEER_OPTIONS);

    peer.on("open", () => {
      setStatus("Online — waiting for photos.");
    });

    peer.on("connection", connection => {
      setStatus("Sender connected.");

      window.parts = window.parts || {};

      connection.on("data", async message => {
        if (message.type === "start") {
          window.parts[message.id] = {
            name: message.name,
            mime: message.mime,
            size: message.size,
            chunks: [],
            bytes: 0
          };
          return;
        }

        if (message.type === "chunk" && window.parts[message.id]) {
          const item = window.parts[message.id];
          item.chunks.push(message.data);
          if (message.data?.size != null) {
            item.bytes += message.data.size;
          } else if (message.data?.byteLength != null) {
            item.bytes += message.data.byteLength;
          }
          return;
        }

        if (message.type === "end" && window.parts[message.id]) {
          const item = window.parts[message.id];

          try {
            const blob = new Blob(item.chunks, {
              type: item.mime
            });

            // Check that the browser can actually decode the image.
            const testUrl = URL.createObjectURL(blob);
            const testImage = new Image();

            const valid = await new Promise(resolve => {
              testImage.onload = () => resolve(true);
              testImage.onerror = () => resolve(false);
              testImage.src = testUrl;
            });

            URL.revokeObjectURL(testUrl);

            if (!valid) {
              setStatus(`❌ ${item.name} was received but is corrupted. Please resend it.`);
              delete window.parts[message.id];
              return;
            }

            const url = URL.createObjectURL(blob);

            photos.push({
              url,
              name: item.name
            });

            await savePhoto(item.name, item.mime, blob);

            delete window.parts[message.id];

            // Show the newly received photo immediately, then continue the slideshow.
            index = photos.length - 1;
            show(true);

            setStatus("Photo received.");
          } catch (err) {
            delete window.parts[message.id];
            setStatus("❌ Could not load that photo.");
          }
        }
      });

      connection.on("close", () => {
        setStatus("Online — waiting for photos.");
      });

      connection.on("error", err => {
        setStatus(
          "❌ Sender connection error: " +
          (err.message || "unknown error")
        );
      });
    });

    peer.on("disconnected", () => {
      setStatus("Reconnecting…");
      setTimeout(() => {
        try {
          if (peer && peer.disconnected) peer.reconnect();
        } catch (_) {}
      }, 1000);
    });

    peer.on("error", err => {
      const type = err?.type || "unknown";

      if (type === "unavailable-id") {
        try { peer.destroy(); } catch (_) {}

        // The old browser tab may still be using the previous ID.
        setTimeout(() => {
          code = String(Math.floor(100000 + Math.random() * 900000));
          localStorage.setItem("myPhotoFrameCode", code);
          $("code").textContent = code;
          startPeer();
        }, 1000);
      } else if (
        type === "network" ||
        type === "server-error" ||
        type === "socket-error" ||
        type === "socket-closed"
      ) {
        setStatus("❌ Can't reach the internet connection server.");
      } else {
        setStatus("❌ Frame error: " + (err.message || type));
      }
    });
  }

  $("menuButton").onclick = () => {
    $("menu").style.display = "block";
  };

  $("close").onclick = () => {
    $("menu").style.display = "none";
  };

  $("next").onclick = () => {
    if (photos.length) {
      index = (index + 1) % photos.length;
      show(true);
    }
  };

  $("full").onclick = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (_) {}
  };

  $("settings").onclick = () => {
    location.href = "settings.html";
  };

  startPeer();
  loadSavedPhotos();
}
