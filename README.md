---
theme: awesome-green
highlight: a11y-dark
---
最近有个录制浏览器标签页的需求，调研发现`Screenity`浏览器插件就可以实现这个功能，于是就调研了具体的实现方法。

由于我们的功能适配是基于`mainfest V2`的，所以我们先来看`V2`如何实现页面录制，注意这里我们只进行浏览器页面的录制，并不涉及桌面，窗口的录制。该部分的录制可以通过[`navigator.mediaDevices.getDisplayMedia`]([MediaDevices.getDisplayMedia() - Web API | MDN](https://developer.mozilla.org/zh-CN/docs/Web/API/MediaDevices/getDisplayMedia))来实现。

![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/bb87f35233274d1d9572a589c59d71d6~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgU3Bpcml0ZWRfQXdheQ==:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiMjIyNTA2NzI2NzIwNDkzNSJ9&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1744119390&x-orig-sign=Zh9b%2FrLaILXQLgyhlqAHWzeRAXE%3D)

## manifest V2 实现
### 主要流程
对于插件来说，我们既可以调用html5提供的录制api也可以调用chrome扩展提供的api。
- [`navigator.mediaDevices.getUserMedia`](https://developer.mozilla.org/zh-CN/docs/Web/API/MediaDevices/getUserMedia)
- [`chrome.tabCapture.capture`](https://www.bing.com/search?q=chrome.tabCapture.capture&form=ANNTH1&refig=67f3d4a0091d4ab9bdb781b0ddcfec7a&pc=NMTS)，这里需要设置`tabCapture`权限。

在插件中不管使用哪种方式获取`stream`，都必须满足一些条件，不然获取到的`stream`为null。所以在内容脚本中直接发送消息到后台获取 stream 是无效的。

经过测试发现有三种方式可以获取到 stream
- 点击 popup 和插件进行交互(点击后发送消息)
- 设置右键菜单和插件进行交互
- 设置快捷键和插件进行交互

```js
// 获取streamId
chrome.tabCapture.getMediaStreamId({
  targetTabId: id,
});

chrome.tabCapture.capture({
  audio: true,
  video: true,
  audioConstraints: {
    mandatory: {
      chromeMediaSource: "tab",
      chromeMediaSourceId: streamId, // 也可以设置当前tabId
    },
  },
  videoConstraints: {
    mandatory: {
      chromeMediaSource: "tab",
      chromeMediaSourceId: streamId, // 也可以设置当前tabId
    },
  },
});

// 或者
navigator.mediaDevices.getUserMedia({
  audio: {
    mandatory: {
      chromeMediaSource: "tab",
      chromeMediaSourceId: streamId,
    },
  },
  video: {
    mandatory: {
      chromeMediaSource: "tab",
      chromeMediaSourceId: streamId,
    },
  },
});
```

获取 stream 后，通过[`MediaRecorder`](https://developer.mozilla.org/zh-CN/docs/Web/API/MediaRecorder)创建录制对象，监听`dataavailable`事件就可以拿到对应的录制数据，然后我们就可以通过可写流将其写入本地文件。这里我们可以调用[`showSaveFilePicker`](https://developer.mozilla.org/zh-CN/docs/Web/API/Window/showSaveFilePicker)选择本地目录边录边写入文件，防止因内存过大造成卡死。
```js
//  选择要保存的文件
const fileHandle = await window.showSaveFilePicker({
    suggestedName: `recording-${Date.now()}.webm`,
    types: [{
      description: 'record tab',
      accept: { 'video/webm': ['.webm'] }
    }]
});
```

```js
const writer = await fileHandle.createWritable();
recorder.ondataavailable = async (e) => {
  try {
    await writer.write(e.data);
  } catch (error) {
    console.error('写入失败:', error);
    stopRecording(tabId);
  }
};
```

监听录制停止，然后通过处理录制文件(.webm)，将`webm` 转换为`mp4`, 因为录制写入的文件没有时间进度且不支持拖拽进度条。

```js
// 方式一： 手动记录录制时间，通过fix-webm-duration进行修复
recorder.onstop = async () => {
  const recordingDuration = Date.now() - startTime;
  // 修复时长元数据
  fixWebmDuration(
    new Blob([arrayBuffer], { type: "video/webm" }),
    recordingDuration,
    async (fixedWebm) => {
      // 然后在进行下载
    },
    { logger: false }
  );
};

// 方式二：通过ffmpeg进行处理(转换时间根据文件大小决定)
ffmpeg -i input.webm -c copy video.mp4
```

### 参数配置

[具体请参考这里](https://www.w3.org/TR/mediacapture-streams/#media-track-constraints)

```js
interface MediaStreamConstraints {
  video?: boolean | MediaTrackConstraints; // 视频配置
  audio?: boolean | MediaTrackConstraints; // 音频配置
  preferCurrentTab?: boolean; // 是否优先捕获当前标签（Chrome 特有，用于屏幕共享）
}

video: {
  // 基础参数
  width: { ideal: 1280 },       // 理想宽度
  height: { min: 720 },         // 最小高度
  frameRate: { max: 30 },       // 最大帧率 默认值 30
  aspectRatio: 1.7777777777777777,     // 宽高比（16:9）

  // 设备选择
  facingMode: "environment",   // 后置摄像头（"user" 为前置）
  deviceId: "摄像头设备ID",     // 指定摄像头设备 enumerateDevices()获取

  // 高级功能
  noiseSuppression: false,       // 降噪
  zoom: { exact: 2 },           // 缩放倍数
  focusMode: "continuous",      // 对焦模式
  resizeMode: "crop-and-scale", // 缩放策略

  // 浏览器兼容性扩展（部分浏览器支持）
  latency: 0,                   // 延迟配置（实验性）
}

audio: {
  // 基础参数
  sampleRate: 48000,            // 采样率（Hz）
  sampleSize: 16,               // 采样位数（bit）
  channelCount: 2,              // 声道数（1=单声道，2=立体声）

  // 设备选择
  deviceId: "麦克风设备ID",     // 指定麦克风设备 enumerateDevices()获取
  groupId: "设备组ID",          // 同一物理设备的组 ID

  // 高级功能
  echoCancellation: false,      // 回音消除
  autoGainControl: false,       // 自动增益
  noiseSuppression: false,      // 降噪
  latency: 0.01,                // 延迟（实验性）

  // 浏览器兼容性扩展（部分浏览器支持）
  suppressLocalAudioPlayback: true // 是否禁止本地播放（WebRTC 场景）
}
```

其中一些参数可以设置约束条件

- 精确匹配：exact: value（若设备不支持，直接报错）
- 理想值：ideal: value（尝试优先匹配，但不强制）
- 范围限制：min, max
## mainfest V2 和 manifest V3后台脚本的区别
### 主要区别
Manifest V2
-   运行环境：独立的 HTML 页面（`background.html`），通过 `background.scripts` 或 `background.page` 定义。
-   生命周期：**持久化**（长期运行），即使没有事件触发也不会被终止。
-   全局对象：支持完整的 Web API，包括 `window`、`document`、`XMLHttpRequest` 等。

Manifest V3
-   运行环境：基于 Service Worker 的脚本（`service_worker` 字段定义），无 HTML 页面。
-   生命周期：**按需启动，空闲时终止**。脚本仅在处理事件时运行，最长存活时间约 5 分钟。
-   全局对象：**无法访问 DOM 相关 API**（如 `window`、`document`），仅支持有限的 Web API（如 `fetch`、`CacheStorage`）。
### API 兼容性变化
-   **Web Request API**
    -   V2：可通过 `chrome.webRequest` 拦截和修改网络请求。
    -   V3：**仅支持只读模式**，修改请求需使用新的 `Declarative Net Request` API（静态规则声明）。
-   **Background Page 的全局状态**
    -   V2：可通过全局变量（如 `window.myData`）保存状态。
    -   V3：**Service Worker 无法持久化全局状态**，需使用 `chrome.storage.local` 存储数据。
-   **长连接通信（如 `chrome.extension.connect`）**
    -   V2：支持长连接（`Port`）保持后台与内容脚本的通信。
    -   V3：**推荐短连接**（`chrome.runtime.sendMessage`），因 Service Worker 可能随时终止。

**新增或改进的 API**

-   **`chrome.scripting` API**  
    替代 V2 的 `chrome.tabs.executeScript`，支持动态注入脚本和 CSS。
-   **`chrome.action` API**  
    统一 V2 的 `chrome.browserAction` 和 `chrome.pageAction`，简化扩展图标管理。
-   **`chrome.alarms`**  
    替代 `setTimeout`/`setInterval`，支持跨 Service Worker 生命周期的定时任务。
    
所以对于V3的实现和V2有很大不同，API不能直接在V3中使用，这就需要扩展页面进行过渡了。
## manifest V3实现
由于后台脚本非常驻，所以我们已经不能再后台脚本中直接调用录制tab页的api了。我们需要开启一个扩展页面进行录制，等到结束录制后关闭临时开启的扩展页面。
```js
function openTempRecordTab(recordPageTabId) {
  chrome.tabs
  .create({
    url: "recorder.html",
    pinned: true,
    index: 0,
  }, (tab) => {
    chrome.tabs.onUpdated.addListener(async function _(
      tabId,
      changeInfo,
      updatedTab
    ) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        tempTabsMap.set(recordPageTabId, tabId) // tabId: tempPageTabId
        chrome.tabs.onUpdated.removeListener(_);
        chrome.tabs.sendMessage(tab.id, {
          type: "loaded",
          tabId: recordPageTabId, // 录制页面tabId
        })
      }
    });
  })
}
```
其他逻辑和v2一样，只是多了几步扩展页面和后台脚本之间的通信而已。

## V2和V3完整源码
[请访问github]([zhang-glitch/record-tsbs](https://github.com/zhang-glitch/record-tsbs))
## 往期年度总结

-   [在上海的忙碌一年，依旧充满憧憬(2024)](https://juejin.cn/post/7454490869981315122 "https://juejin.cn/post/7454490869981315122")
-   [四年沿海城市，刚毕业，一年3家公司](https://juejin.cn/post/7310895905573716005 "https://juejin.cn/post/7310895905573716005")
-   [七月仿佛又回到了那一年（2023年中总结）](https://juejin.cn/post/7254361990076055589 "https://juejin.cn/post/7254361990076055589")
-   [一位初入职场前端仔的年度终结 <回顾2022，展望2023>](https://juejin.cn/post/7188374796114067511 "https://juejin.cn/post/7188374796114067511")
-   [大学两年半的前端学习](https://juejin.cn/post/7046248406464856100 "https://juejin.cn/post/7046248406464856100")

## 往期文章
-   [一个关联本地页面镜像的功能，我了解到这些](https://juejin.cn/post/7486390904992071695)
-   [啊，原来sessionStorage是这样的](https://juejin.cn/post/7474488284418375717)
-   [如何像掘金编辑器一样粘贴图片即可上传服务器](https://juejin.cn/post/7433786904678023220)
-   [Nest装饰器全解析](https://juejin.cn/post/7431969844544831525 "https://juejin.cn/post/7431969844544831525")
-   [Nest世界中的AOP](https://juejin.cn/post/7420325706289332260 "https://juejin.cn/post/7420325706289332260")
-   [Nestjs如何解析http传输的数据](https://juejin.cn/post/7419209528264065076 "https://juejin.cn/post/7419209528264065076")
-   [如何理解js的DOM事件系统](https://juejin.cn/post/7418394742532243456 "https://juejin.cn/post/7418394742532243456")
-   [半年没看vue官网，3.5刚刚发布，趁机整理下](https://juejin.cn/post/7416168084144619574 "https://juejin.cn/post/7416168084144619574")
-   [啊，你还在找一款强大的表格组件吗？](https://juejin.cn/post/7410625892031414298 "https://juejin.cn/post/7410625892031414298")
-   [前端大量数据层级展示及搜索定位预览](https://juejin.cn/post/7403758419360153663 "https://juejin.cn/post/7403758419360153663")
-   [如何从0开始认识m3u8(提取，解析及下载)](https://juejin.cn/post/7418086006116057107 "https://juejin.cn/post/7418086006116057107")
-   [展示大量数据节点(tree)，引发的一次性能排查](https://juejin.cn/post/7392071328528891956 "https://juejin.cn/post/7392071328528891956")
-   [ts装饰器的那点东西](https://juejin.cn/post/7368662916151296039 "https://juejin.cn/post/7368662916151296039")
-   [这是你所知道的ts类型断言和类型守卫吗？](https://juejin.cn/post/7360871152037052416 "https://juejin.cn/post/7360871152037052416")
-   [TypeScript官网内容解读](https://juejin.cn/post/7202132390549356603 "https://juejin.cn/post/7202132390549356603")
-   [经常使用ts的你，知道这些内容？](https://juejin.cn/post/7360498535077003304 "https://juejin.cn/post/7360498535077003304")
-   [你有了解过原生css的scope？](https://juejin.cn/post/7351336619595939880 "https://juejin.cn/post/7351336619595939880")
-   [现在比较常用的移动端调试你知道哪些？](https://juejin.cn/post/7348832432072654886 "https://juejin.cn/post/7348832432072654886")
-   [众多跨标签页通信方式，你知道哪些？（二）](https://juejin.cn/post/7345352532657848371 "https://juejin.cn/post/7345352532657848371")
-   [众多跨标签页通信方式，你知道哪些？](https://juejin.cn/post/7340109700767383604 "https://juejin.cn/post/7340109700767383604")
-   [反调试吗？如何监听devtools的打开与关闭](https://juejin.cn/post/7330021813823750159 "https://juejin.cn/post/7330021813823750159")
-   [因为原生，选择一家公司（前端如何防笔试作弊）](https://juejin.cn/post/7301908233291300900 "https://juejin.cn/post/7301908233291300900")
-   [结合开发，带你熟悉package.json与tsconfig.json配置](https://juejin.cn/post/7298294389478506548 "https://juejin.cn/post/7298294389478506548")
-   [如何优雅的在项目中使用echarts](https://juejin.cn/post/7294541220440752165 "https://juejin.cn/post/7294541220440752165")
-   [如何优雅的做项目国际化](https://juejin.cn/post/7293797226933764134 "https://juejin.cn/post/7293797226933764134")
-   [近三个月的排错，原来的憧憬消失喽](https://juejin.cn/post/7292036126269063178 "https://juejin.cn/post/7292036126269063178")
-   [带你从0开始了解vue3核心（运行时）](https://juejin.cn/post/7291955076100620342 "https://juejin.cn/post/7291955076100620342")
-   [带你从0开始了解vue3核心（computed, watch）](https://juejin.cn/post/7275550540620365878 "https://juejin.cn/post/7275550540620365878")
-   [带你从0开始了解vue3核心（响应式）](https://juejin.cn/post/7274072378606174263 "https://juejin.cn/post/7274072378606174263")
-   [3w+字的后台管理通用功能解决方案送给你](https://juejin.cn/post/7269225865619816483 "https://juejin.cn/post/7269225865619816483")
-   [入职之前，狂补技术，4w字的前端技术解决方案送给你（vue3 + vite ）](https://juejin.cn/post/7251878440327512124 "https://juejin.cn/post/7251878440327512124")

## 专栏文章

-   [重学vue及其生态](https://juejin.cn/column/7036633477013307423 "https://juejin.cn/column/7036633477013307423")
-   [前端面试](https://juejin.cn/column/7085181986347679751 "https://juejin.cn/column/7085181986347679751")
-   [前端工程化](https://juejin.cn/column/7215977393697587259 "https://juejin.cn/column/7215977393697587259")
-   [amis 低代码实战](https://juejin.cn/column/7171775932809052174 "https://juejin.cn/column/7171775932809052174")
-   [协议与安全](https://juejin.cn/column/7090398104549064718 "https://juejin.cn/column/7090398104549064718")
-   [重学react](https://juejin.cn/column/7073656450874081316 "https://juejin.cn/column/7073656450874081316")
-   [重学nodejs](https://juejin.cn/column/7036633282204663822 "https://juejin.cn/column/7036633282204663822")
-   [工作总结](https://juejin.cn/column/7133877511707951111 "https://juejin.cn/column/7133877511707951111")

🔥如果此文对你有帮助的话，欢迎💗**关注**、👍**点赞**、⭐**收藏**、**✍️评论，**    支持一下博主~

**公众号：全栈追逐者，不定期的更新内容，关注不错过哦！**



