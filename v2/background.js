const recordingStates = new Map()
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'start') {
    startRecording(message.tabId)
  } else if (message.type === 'stop') {
    stopRecording(message.tabId)
  }
})

function getConfig () {
  const ram = navigator.deviceMemory
  let audioBitsPerSecond = 128000
  let videoBitsPerSecond = 5000000
  // 获取显示器分辨率自动适配
  let width = screen.width * window.devicePixelRatio
  let height = screen.height * window.devicePixelRatio
  if (ram >= 8 && width >= 3840 && height >= 2160) {
    width = 4096
    height = 2160
    audioBitsPerSecond = 192000
    videoBitsPerSecond = 40000000
  } else if (ram >= 4 && width >= 1920 && height >= 1080) {
    width = 1920
    height = 1080
    audioBitsPerSecond = 192000
    videoBitsPerSecond = 8000000
  } else if (ram >= 2 && width >= 1280 && height >= 720) {
    width = 1280
    height = 720
    audioBitsPerSecond = 128000
    videoBitsPerSecond = 5000000
  } else {
    width = 854
    height = 480
    audioBitsPerSecond = 96000
    videoBitsPerSecond = 2500000
  }

  const mimeTypes = [
    'video/webm;codecs=avc1',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm;codecs=h264',
    'video/webm'
  ]
  const mimeType =
    mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ||
    'video/webm;codecs=vp8,opus'

  const  fps = 30
  return {
    width,
    height,
    audioBitsPerSecond,
    videoBitsPerSecond,
    mimeType,
    fps
  }
}

async function startRecording (tabId) {
  if (recordingStates.has(tabId)) {
    updateStatus(`标签页 ${tabId} 已经在录制中`, 'red')
    return
  }
  // https://developer.mozilla.org/zh-CN/docs/Web/API/Window/showSaveFilePicker 选择要保存的文件
  const fileHandle = await window.showSaveFilePicker({
    suggestedName: `recording-${Date.now()}.webm`,
    types: [
      {
        description: 'WebM Video',
        accept: { 'video/webm': ['.webm'] }
      }
    ]
  })

  try {
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId(
        {
          targetTabId: tabId
        },
        resolve
      )
    })
    const { width, height, audioBitsPerSecond, videoBitsPerSecond, mimeType, fps } =
      getConfig()
    const stream = await new Promise((resolve) => {
      chrome.tabCapture.capture(
        {
          audio: true,
          video: true,
          audioConstraints: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId
            }
          },
          videoConstraints: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId,
              width: {
                ideal: width,
              },
              height: {
                ideal: height,
              },
              frameRate: {
                ideal: fps,
              },
            },
          }
        },
        resolve
      )
    })
    const writer = await fileHandle.createWritable()
    const recorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      audioBitsPerSecond: audioBitsPerSecond,
      videoBitsPerSecond: videoBitsPerSecond
    })
    const startTime = Date.now()
    recorder.ondataavailable = async (e) => {
      try {
        await writer.write(e.data)
      } catch (error) {
        console.error('写入失败:', error)
        stopRecording(tabId)
      }
    }

    recorder.onstop = async () => {
      try {
        await writer.close()
        const recordingDuration = Date.now() - startTime
        console.log('持续时间', recordingDuration)
      } catch (error) {
        console.error('关闭文件失败:', error)
      } finally {
        stream.getTracks().forEach((track) => track.stop())
        recordingStates.delete(tabId)
      }
    }

    recorder.start(1000)
    recordingStates.set(tabId, { recorder, stream, writer, startTime })
    updateStatus(`开始录制标签页 ${tabId}`, 'green')
  } catch (error) {
    console.error(`开始录制失败: ${error}`)
    updateStatus(`录制失败: ${error.message}`, 'red')
  }
}

function stopRecording (tabId) {
  const state = recordingStates.get(tabId)
  if (state) {
    state.recorder.stop()
    updateStatus(`正在保存标签页 ${tabId} 的录制内容...`, 'blue')
  } else {
    updateStatus(`标签页 ${tabId} 没有正在进行的录制`, 'red')
  }
}

function updateStatus (text, color) {
  chrome.runtime.sendMessage({
    type: 'status',
    text: text,
    color: color
  })
}

// 清理标签页关闭时的录制状态
chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingStates.has(tabId)) {
    stopRecording(tabId)
  }
})

// 设置contextMenu
chrome.runtime.onInstalled.addListener(function () {
  const contexts = [
    {
      id: 'start',
      title: '开始录制'
    },
    {
      id: 'stop',
      title: '结束录制'
    }
  ]

  contexts.forEach((item) => {
    chrome.contextMenus.create({
      title: item.title,
      id: item.id,
      contexts: ['page']
    })
  })
})

function getCurrentTab () {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      resolve(tabs[0].id)
    })
  })
}

// 当点击对应的菜单时执行的动作
chrome.contextMenus.onClicked.addListener(async (info) => {
  console.log('点击菜单', info)
  const tabId = await getCurrentTab()
  if (info.menuItemId === 'start') {
    startRecording(tabId)
  } else {
    stopRecording(tabId)
  }
})

// 监听快捷键
chrome.commands.onCommand.addListener(async (command) => {
  console.log(`Command: ${command}`)
  const tabId = await getCurrentTab()
  if (command === 'start') {
    startRecording(tabId)
  } else {
    stopRecording(tabId)
  }
})
