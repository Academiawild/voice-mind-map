# 本地语音识别依赖

这个文件夹只保存“如何安装语音识别工具”的清单。

会上传到 GitHub：

- `README.md`：当前说明。
- `asr-requirements.txt`：Python 安装清单。

不会上传到 GitHub：

- `local/asr-venv/`：本机 Python 运行环境。
- `local/FunASR/`：本机下载的 FunASR。

这些本机文件体积很大，但都可以重新生成。需要重新安装时，回到项目最外层双击：

```text
install.command
```

普通网页依赖保存在项目最外层的 `node_modules/`，它也不会上传到 GitHub。
