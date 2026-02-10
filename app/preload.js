const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 글 작성
  writePost: (options) => ipcRenderer.invoke('write-post', options),

  // 연결 테스트
  testConnection: () => ipcRenderer.invoke('test-connection'),

  // 설정 관련
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getConfig: () => ipcRenderer.invoke('get-config'),
  isConfigured: () => ipcRenderer.invoke('is-configured'),

  // 예약 발행 큐
  startScheduledPosts: (options) => ipcRenderer.invoke('start-scheduled-posts', options),
  cancelScheduledPosts: () => ipcRenderer.invoke('cancel-scheduled-posts'),
  getQueueStatus: () => ipcRenderer.invoke('get-queue-status'),
  onQueueProgress: (callback) => ipcRenderer.on('queue-progress', (_, data) => callback(data)),

  // Google 서비스 계정 JSON 파일 선택
  selectJsonFile: () => ipcRenderer.invoke('select-json-file')
});
