const response = await fetch("http://127.0.0.1:4101/__preview/replay", { method: "POST" });
if (!response.ok) throw new Error(`Replay failed (${response.status})`);
console.log("Replaying progress, a completed full version and a new notice.");
