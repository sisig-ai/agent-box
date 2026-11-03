// One fetch of config.json, shared by the header readout and the stack grid.
// The promise is cached so a second caller never repeats the request, and a
// failed load clears the cache so the next mount can try again.
let pending = null;

export function loadConfig() {
  if (!pending) {
    pending = fetch('config.json')
      .then((res) => {
        if (!res.ok) throw new Error(`config.json ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}
