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

  // 글 작성 진행률 수신
  onWriteProgress: (callback) => ipcRenderer.on('write-progress', (_, data) => callback(data)),

  // Google 서비스 계정 JSON 파일 선택
  selectJsonFile: () => ipcRenderer.invoke('select-json-file'),

  // 외부 브라우저로 링크 열기 (메인 프로세스에서 실행)
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 발행 이력 로그
  getPostLog: () => ipcRenderer.invoke('get-post-log'),
  clearPostLog: () => ipcRenderer.invoke('clear-post-log'),

  // 사이트별 연결 테스트
  testSiteConnection: (site) => ipcRenderer.invoke('test-site-connection', site)
});
