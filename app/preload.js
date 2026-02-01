const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 글 작성
  writePost: (options) => ipcRenderer.invoke('write-post', options),

  // 연결 테스트
  testConnection: () => ipcRenderer.invoke('test-connection'),

  // 설정 관련
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getConfig: () => ipcRenderer.invoke('get-config'),
  isConfigured: () => ipcRenderer.invoke('is-configured')
});
