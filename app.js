const $ = id => document.getElementById(id);

const PEER_OPTIONS = {
  host: "0.peerjs.com",
  port: 443,
  path: "/",
  secure: true,
  debug: 1
};

/* =========================
   SENDER
   ========================= */
if ($("files")) {
  let conn = null;
  let selected = [];
  let peer = null;

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
      peer = null;
      conn = null;
    }

    $("status").textContent = "Connecting to frame…";

    peer = new Peer(undefined, PEER_OPTIONS);

    peer.on("open", () => {
      $("status").textContent = "Found the connection server. Connecting to frame…";

      conn = peer.connect("frame-" + code, {
        reliable: true,
        serialization: "json"
      });

      const timeout = setTimeout(() => {
        if (!conn || !conn.open) {
          $("status").textContent =
            "❌ Could not connect to that frame. Check the code and make sure the frame says Online.";
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
        $("status").textContent = "❌ Frame connection error: " + (err.message || err.type || "unknown");
      });
    });

    peer.on("error", err => {
      const type = err?.type || "unknown";
      if (type === "peer-unavailable") {
        $("status").textContent =
          "❌ Frame not found. Check the 6-digit code and wait until the frame says Online.";
      } else if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed") {
        $("status").textContent =
          "❌ Could not reach the internet connection server. Open this website from HTTPS (not a local file).";
      } else {
        $("status").textContent = "❌ Connection error: " + (err.message || type);
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

        if (file.size > 25 * 1024 * 1024) {
          $("status").textContent =
            `Skipped ${file.name}: maximum size is 25 MB.`;
          continue;
        }

        $("status").textContent =
          `Sending photo ${n + 1} of ${selected.length}…`;

        const buffer = await file.arrayBuffer();
        const id = crypto.randomUUID();
        const chunkSize = 48 * 1024;

        conn.send({
          type: "start",
          id,
          name: file.name,
          mime: file.type,
          size: buffer.byteLength
        });

        for (let i = 0; i < buffer.byteLength; i += chunkSize) {
          conn.send({
            type: "chunk",
            id,
            data: buffer.slice(i, i + chunkSize)
          });

          await new Promise(resolve => setTimeout(resolve, 0));
        }

        conn.send({ type: "end", id });
      }

      $("status").textContent = "✅ All selected photos sent.";
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
      saved === "15000" ? "15 seconds" : "30 seconds";
  }

  $("speed").addEventListener("change", () => {
    const value =
      $("speed").value === "3 seconds" ? "3000" :
      $("speed").value === "8 seconds" ? "8000" :
      $("speed").value === "15 seconds" ? "15000" : "30000";

    localStorage.setItem("myPhotoFrameSpeed", value);
    if ($("savedMsg")) $("savedMsg").textContent = "✅ Saved on this device.";
  });
}

/* =========================
   FRAME
   ========================= */
if ($("code") && $("photo")) {
  const DB_NAME = "myPhotoFrameDB";
  const STORE = "photos";

  // Keep the same code on this frame device.
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
    try {
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
    } catch (err) {
      console.warn("Could not save photo:", err);
    }
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

      photos = rows.map(row => ({
        url: URL.createObjectURL(row.blob),
        name: row.name
      }));

      if (photos.length) {
        show(false);
      }
    } catch (err) {
      console.warn("Could not restore photos:", err);
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
      setStatus("🟢 Online — waiting for photos.");
    });

    peer.on("connection", connection => {
      setStatus("🟢 Sender connected.");

      window.parts = window.parts || {};

      connection.on("data", async message => {
        if (message.type === "start") {
          window.parts[message.id] = {
            name: message.name,
            mime: message.mime,
            size: message.size,
            arr: []
          };
        }

        if (message.type === "chunk" && window.parts[message.id]) {
          window.parts[message.id].arr.push(message.data);
        }

        if (message.type === "end" && window.parts[message.id]) {
          const item = window.parts[message.id];

          const blob = new Blob(item.arr, {
            type: item.mime
          });

          const url = URL.createObjectURL(blob);

          photos.push({
            url,
            name: item.name
          });

          delete window.parts[message.id];

          await savePhoto(item.name, item.mime, blob);

          index = photos.length - 1;
          show(true);

          setStatus("🟢 Photo received.");
        }
      });

      connection.on("close", () => {
        setStatus("🟢 Online — waiting for photos.");
      });

      connection.on("error", err => {
        setStatus(
          "❌ Sender connection error: " +
          (err.message || err.type || "unknown")
        );
      });
    });

    peer.on("disconnected", () => {
      setStatus("⚠️ Connection server disconnected — reconnecting…");
      setTimeout(() => {
        if (peer && peer.disconnected) {
          try { peer.reconnect(); } catch (_) {}
        }
      }, 1500);
    });

    peer.on("error", err => {
      const type = err?.type || "unknown";

      if (type === "unavailable-id") {
        // The old page can still be holding the same code.
        setStatus("⚠️ This frame code is already in use. Reloading with a new code…");
        try { peer.destroy(); } catch (_) {}

        setTimeout(() => {
          code = String(Math.floor(100000 + Math.random() * 900000));
          localStorage.setItem("myPhotoFrameCode", code);
          $("code").textContent = code;
          startPeer();
        }, 1200);

      } else if (
        type === "network" ||
        type === "server-error" ||
        type === "socket-error" ||
        type === "socket-closed"
      ) {
        setStatus(
          "❌ Can't reach the connection server. Use the website over HTTPS, not by double-clicking an HTML file."
        );
      } else {
        setStatus(
          "❌ Frame error: " + (err.message || type)
        );
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
