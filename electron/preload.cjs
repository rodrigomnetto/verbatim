const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("verbatim", {
  call: (method, payload) => ipcRenderer.invoke("verbatim", method, payload),
});
