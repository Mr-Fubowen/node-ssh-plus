const { format } = require('util')
const { isAsyncFunction } = require('util/types')
const { basename, join, dirname, posix, extname } = require('path')
const zlib = require('zlib')
const crypto = require('crypto')
const { spawn } = require('child_process')
const os = require('os')
const EventEmitter = require('events')

const fs = require('fs-extra')
const { fromUnixTime, format: formatTime } = require('date-fns')
const _ = require('lodash')
const { NodeSSH } = require('node-ssh')

const StatusEnum = require('./StatusEnum')
const IsChangedEnum = require('./IsChangedEnum')
const { ConnectError, ReconnectError, MaxRetriesExceededError } = require('./Exception')

class SSHClient extends NodeSSH {
    #sftpCache = new Map()
    trashcanPath = '/trashcan'
    options
    clientCacheRootPath = ''
    maxPath = 255
    logPath = ''
    isUserClosed = true
    emitter = new EventEmitter()
    maxTryCount = 3

    unixSecondFormat(unixSecond, format = 'yyyy-MM-dd HH:mm:ss') {
        const date = fromUnixTime(unixSecond)
        return formatTime(date, format)
    }
    attachSuffixToFilePath(filePath, suffix) {
        const path = dirname(filePath)
        const ext = extname(filePath)
        const name = basename(filePath, ext)
        return posix.join(path, name + suffix + ext)
    }
    toChunk(total, chunkSize) {
        const sliceList = []
        const chunkCount = Math.ceil(total / chunkSize)
        for (let index = 0; index < chunkCount; index++) {
            let start = index * chunkSize
            let end = Math.min(total, start + chunkSize)
            sliceList.push({
                start,
                end,
                index
            })
        }
        return sliceList
    }
    changeFileExtension(filePath, extension) {
        const path = dirname(filePath)
        const name = basename(filePath, extname(filePath))
        return posix.join(path, name + extension)
    }
    clientCachePath(serverPath) {
        return join(this.clientCacheRootPath, serverPath)
    }
    clientSourcePath(serverPath) {
        return this.clientCachePath(serverPath) + '.source'
    }
    pathLength(path) {
        return Buffer.byteLength(path, 'utf8')
    }
    validatePathOrThrow(path) {
        const name = basename(path)
        this.validateNameOrThrow(name)
        if (this.pathLength(path) > this.maxPath) {
            throw new Error(this.MESSAGES.PATH_LENGTH(this.maxPath))
        }
    }
    validateNameOrThrow(name) {
        if (/[\\/:*?"<>|]/.test(name)) {
            throw new Error(this.MESSAGES.INVALID_CHARACTERS)
        }

        const reservedNames = [
            'CON',
            'PRN',
            'AUX',
            'NUL',
            'COM1',
            'COM2',
            'COM3',
            'COM4',
            'COM5',
            'COM6',
            'COM7',
            'COM8',
            'COM9',
            'LPT1',
            'LPT2',
            'LPT3',
            'LPT4',
            'LPT5',
            'LPT6',
            'LPT7',
            'LPT8',
            'LPT9'
        ]

        if (reservedNames.includes(name.toUpperCase())) {
            throw new Error(this.MESSAGES.RESERVED_NAME(name))
        }

        if (name.length === 0) {
            throw new Error(this.MESSAGES.EMPTY_NAME)
        }

        if (name.length > this.maxPath) {
            throw new Error(this.MESSAGES.MAX_LENGTH(this.maxPath))
        }

        if (name.endsWith(' ')) {
            throw new Error(this.MESSAGES.TRAILING_SPACE)
        }
    }
    isValidName(name) {
        try {
            this.validateNameOrThrow(name)
            return true
        } catch (error) {
            return false
        }
    }
    isValidPath(path) {
        try {
            this.validatePathOrThrow(path)
            return true
        } catch (error) {
            return false
        }
    }

    async sftp(tag = 'SHORT_SFTP') {
        if (this.#sftpCache.has(tag)) {
            return this.#sftpCache.get(tag)
        }
        const sftp = await this.requestSFTP()
        this.#sftpCache.set(tag, sftp)
        return sftp
    }
    async stat(serverPath) {
        return await new Promise((resolve, reject) => {
            this.sftp().then(sftp => {
                sftp.stat(serverPath, (error, stat) => {
                    if (error) {
                        return reject(error)
                    }
                    resolve(stat)
                })
            })
        })
    }

    async hasFileCache(serverFile) {
        const sourcePath = this.clientSourcePath(serverFile)
        if (await fs.pathExists(sourcePath)) {
            const stats = await this.stat(serverFile)
            const sourceJson = await fs.readJson(sourcePath, {
                encoding: 'utf8'
            })
            if (sourceJson.mtime == stats.mtime) {
                return true
            }
        }
        return false
    }

    async checkOrUpdateFileCache(serverFile, onProgress) {
        if (await this.hasFileCache(serverFile)) {
            return
        }
        const cachePath = this.clientCachePath(serverFile)
        await this.downloadFile(cachePath, serverFile, onProgress)
        const sourcePath = this.clientSourcePath(serverFile)
        const stats = await this.stat(serverFile)
        await fs.writeJson(sourcePath, {
            serverPath: serverFile,
            host: this.options.host,
            mtime: stats.mtime,
            size: stats.size
        })
    }

    async close() {
        this.isUserClosed = true
        this.dispose()
        this.#sftpCache.clear()
    }

    async shell() {
        return this.requestShell()
    }

    async pwd() {
        return await this.execute('pwd')
    }

    async cd(path, currentPath, proviousPath) {
        let target = path.trim()
        if (target === '-') {
            if (proviousPath) {
                target = proviousPath
            } else {
                throw new Error('没有上一次路径')
            }
        }
        if (target.startsWith('~')) {
            const home = await this.execute('echo ~')
            target = posix.join(home, target.slice(1))
        }
        return posix.resolve(currentPath, target)
    }

    async execute(command, options) {
        const result = await super.execCommand(command, options)
        if (result.code == 0 || !result.stderr) {
            return result.stdout
        }
        throw new Error(result.stderr)
    }

    async executeText(text, options) {
        const { onOutput } = options || {}
        const commandList = text.split('\n')
        let cwd = await this.pwd()
        let previous = ''
        onOutput?.(0, '当前工作目录: ' + cwd)
        for (const item of commandList) {
            try {
                let msg = ''
                item.startsWith('echo') || onOutput?.(1, item)
                let match = item.match(/^\s*cd\s+(.+)$/)
                if (match) {
                    cwd = await this.cd(match[1], cwd, previous)
                    msg = '进入目录: ' + cwd
                } else {
                    msg = await this.execute(item, {
                        cwd: cwd
                    })
                }
                onOutput?.(2, msg)
            } catch (error) {
                onOutput?.(3, error.message || '执行出错, 但无错误详情!')
                break
            }
        }
    }

    async readPath(serverPath) {
        return await new Promise((resolve, reject) => {
            this.sftp().then(sftp => {
                sftp.readdir(serverPath, (error, items) => {
                    if (error) {
                        return reject(error)
                    }
                    resolve(items)
                })
            })
        })
    }

    async copy(clientPath, serverPath) {
        const command = format('cp -r -n "%s" "%s"', clientPath, serverPath)
        await this.execCommand(command)
    }

    async createBackupOfVersion(serverPath, isFile) {
        let name = basename(serverPath)
        let ext = ''
        if (isFile) {
            ext = extname(name)
            name = basename(name, ext)
        }
        const parentPath = dirname(serverPath)
        const items = await this.readPath(parentPath)
        let max = 0
        let suffix = 'v'
        const regex = new RegExp(format('%s-%s(\\d+)%s', name, suffix, ext && '\\' + ext))
        items?.forEach(it => {
            const match = it.filename.match(regex)
            if (match) {
                max = Math.max(max, parseInt(match[1]))
            }
        })
        const newRemote = posix.join(parentPath, format('%s-%s%s%s', name, suffix, max + 1, ext))
        await this.copy(serverPath, newRemote)
    }

    async createTimePointBackup(serverPath, isFile) {
        let name = basename(serverPath)
        let ext = ''
        if (isFile) {
            ext = extname(name)
            name = basename(name, ext)
        }
        const parentPath = dirname(serverPath)
        const now = new Date()
        const timestamp = format('YYYYMMDDHHmmss')
        const newRemote = posix.join(parentPath, format('%s-%s%s', name, timestamp, ext))
        await this.copy(serverPath, newRemote)
    }

    async move(source, target) {
        const command = format('mv "%s" "%s"', source, target)
        await this.execCommand(command)
    }

    async merge(source, target, onMerge) {
        const sourceStat = await this.stat(source)
        const queue = [
            {
                source,
                sourceStat,
                target
            }
        ]
        let code = 0
        while (queue.length > 0) {
            let item = queue.shift()
            try {
                item.targetStat = await this.stat(item.target)
                if (item.sourceStat.isDirectory()) {
                    const children = await this.readPath(item.source)
                    children.forEach(it => {
                        queue.push({
                            source: posix.join(item.source, it.filename),
                            sourceStat: it.attrs,
                            target: posix.join(item.target, it.filename)
                        })
                    })
                } else {
                    code = await onMerge?.(item)
                    if (code == -1) {
                        break
                    }
                }
            } catch (_) {
                await this.move(item.source, item.target)
            }
        }
        if (code != -1) {
            await this.remove(source)
        }
        return code
    }

    async remove(path) {
        const command = format('rm -rf "%s"', path)
        await this.execCommand(command)
    }

    async removeContent(path) {
        const command = format('rm -rf "%s"', path)
        await this.execCommand(command)
        await this.ensurePath(path)
    }

    async brotliCompress(text) {
        return await new Promise((resolve, reject) => {
            zlib.brotliCompress(text, (error, resurt) => {
                if (error) {
                    return reject(error)
                }
                resolve(resurt.toString('base64url'))
            })
        })
    }

    async brotliDecompress(text) {
        return await new Promise((resolve, reject) => {
            const buffer = Buffer.from(text, 'base64url')
            zlib.brotliDecompress(buffer, (error, resurt) => {
                if (error) {
                    return reject(error)
                }
                resolve(resurt.toString('utf-8'))
            })
        })
    }

    async findAvailableName(serverPath, nameFn) {
        const items = await this.readPath(serverPath)
        const set = new Set(items.map(item => item.filename))
        let index = 1
        while (set.has(nameFn(index))) {
            index++
        }
        return nameFn(index)
    }

    async symlink(serverPath, linkPath) {
        const name = basename(serverPath)
        const newName = await this.findAvailableName(linkPath, i =>
            format('%s - 快捷方式(%s)', name, i)
        )
        const shortcutPath = posix.join(linkPath, newName)
        return await new Promise((resolve, reject) => {
            this.sftp().then(sftp => {
                sftp.symlink(serverPath, shortcutPath, error => {
                    if (error) {
                        return reject(error)
                    }
                    resolve(shortcutPath)
                })
            })
        })
    }
    async realpath(serverPath) {
        return await new Promise((resolve, reject) => {
            this.sftp().then(sftp => {
                sftp.realpath(serverPath, (error, abs) => {
                    if (error) {
                        return reject(error)
                    }
                    resolve(abs)
                })
            })
        })
    }

    async symlinkTarget(serverPath) {
        const target = await new Promise((resolve, reject) => {
            this.sftp().then(sftp => {
                sftp.readlink(serverPath, (error, target) => {
                    if (error) {
                        return reject(error)
                    }
                    resolve(target)
                })
            })
        })
        return posix.resolve(dirname(serverPath), target)
    }

    async ensureTrashcan(path) {
        this.trashcanPath = path || this.trashcanPath
        return await this.ensurePath(this.trashcanPath)
    }

    async removeToTrashcan(remote) {
        const name = basename(remote)
        const time = Date.now()
        const metedata = {
            s: remote,
            d: time
        }
        const json = JSON.stringify(metedata)
        const zipText = await this.brotliCompress(json)
        if (zipText.length < 255) {
            const target = posix.join(this.trashcanPath, zipText)
            await this.move(remote, target)
        } else {
            const target = posix.join(this.trashcanPath, time + '-' + name)
            await this.move(remote, target)
            await this.writeJson(target + '.metedata', metedata)
        }
    }

    async parseMetedata(remote) {
        const name = basename(remote)
        let text = ''
        if (/^[0-9]+-/.test(name)) {
            text = this.readJson(remote + '.metedata')
        } else {
            text = await this.brotliDecompress(name)
        }
        return JSON.parse(text)
    }

    async write(fd, buffer, position) {
        return await new Promise((resolve, reject) => {
            this.sftp().then(sftp => {
                sftp.write(fd, buffer, 0, buffer.length, position, error => {
                    if (error) {
                        return reject(error)
                    }
                    resolve(serverFile)
                })
            })
        })
    }

    async writeFile(serverFile, data, options) {
        const remotePath = dirname(serverFile)
        await this.ensurePath(remotePath)
        return await new Promise((resolve, reject) => {
            this.sftp().then(sftp => {
                sftp.writeFile(serverFile, data, options, error => {
                    if (error) {
                        return reject(error)
                    }
                    resolve(serverFile)
                })
            })
        })
    }

    async writeText(serverFile, data) {
        return await this.writeFile(serverFile, data, {
            encoding: 'utf8'
        })
    }

    async writeJson(serverFile, data) {
        const json = JSON.stringify(data)
        return await this.writeText(serverFile, json)
    }

    async readFile(serverFile, options) {
        return await new Promise((resolve, reject) => {
            this.sftp().then(sftp => {
                sftp.readFile(serverFile, options, (error, result) => {
                    if (error) {
                        return reject(error)
                    }
                    resolve(result)
                })
            })
        })
    }

    async readText(serverFile) {
        return await this.readFile(serverFile, {
            encoding: 'utf8'
        })
    }

    async readJson(serverFile) {
        const text = await this.readText(serverFile)
        return JSON.parse(text)
    }

    async truncate(serverFile, length) {
        const command = format('truncate -s %s "%s"', length, serverFile)
        return await this.execute(command)
    }

    async rename(sourcePath, name) {
        return await new Promise((resolve, reject) => {
            this.validateNameOrThrow(name)
            const parentPath = dirname(sourcePath)
            const targetPath = posix.join(parentPath, name)
            this.sftp().then(sftp => {
                sftp.rename(sourcePath, targetPath, (error, stat) => {
                    if (error) {
                        return reject(error)
                    }
                    resolve(stat)
                })
            })
        })
    }

    async open(serverFile, mode) {
        return await new Promise((resolve, reject) => {
            this.sftp().then(sftp => {
                sftp.open(serverFile, mode, (error, buffer) => {
                    if (error) {
                        return reject(error)
                    }
                    resolve(buffer)
                })
            })
        })
    }

    async exists(remotePath) {
        return await new Promise(resolve => {
            this.sftp().then(sftp => {
                sftp.exists(remotePath, hasError => {
                    resolve(hasError)
                })
            })
        })
    }

    async ensurePath(path) {
        const command = format('mkdir -p "%s"', path)
        await this.execCommand(command)
    }

    async upload(client, server, onProgress) {
        const stat = await fs.stat(client)
        if (stat.isDirectory()) {
            return this.uploadFolder(client, server, onProgress)
        }
        const name = basename(client)
        const serverFile = posix.join(server, name)
        return await this.uploadFile(client, serverFile, onProgress)
    }

    async uploadFile(clientFile, serverFile, onProgress) {
        const sftp = await this.sftp()
        onProgress?.call(this, {
            status: StatusEnum.STARTED,
            clientFile,
            serverFile
        })
        try {
            await this.putFile(clientFile, serverFile, sftp, {
                step: (total, _, fsize) => {
                    const progress = {
                        status: StatusEnum.IN_PROGRESS,
                        clientFile,
                        serverFile,
                        total: fsize,
                        current: total,
                        percentage: Math.ceil((total * 100) / fsize)
                    }
                    onProgress?.call(this, progress)
                }
            })
            onProgress?.call(this, {
                status: StatusEnum.SUCCESS,
                clientFile,
                serverFile
            })
        } catch (error) {
            onProgress?.call(this, {
                status: StatusEnum.FAILURE,
                clientFile,
                serverFile,
                error
            })
        }
    }

    async uploadFolder(clientPath, serverPath, onProgress) {
        await fs.ensureDir(clientPath)
        const sftp = await this.sftp()
        const successs = []
        const failures = []
        onProgress?.call(this, {
            status: StatusEnum.STARTED,
            clientPath,
            serverPath
        })
        await this.putDirectory(clientPath, serverPath, {
            sftp,
            recursive: true,
            tick: (clientFile, serverFile, error) => {
                if (error) {
                    failures.push({
                        clientFile,
                        serverFile,
                        error
                    })
                } else {
                    successs.push({
                        clientFile,
                        serverFile
                    })
                }
                onProgress?.call(this, {
                    status: StatusEnum.IN_PROGRESS,
                    clientFile,
                    serverFile,
                    error
                })
            }
        })
        if (failures.length == 0) {
            onProgress?.call(this, {
                status: StatusEnum.SUCCESS,
                clientPath,
                serverPath,
                successs
            })
        } else if (successs.length > 0) {
            onProgress?.call(this, {
                status: StatusEnum.PARTIAL_FAILURE,
                clientPath,
                serverPath,
                successs,
                failures
            })
        } else {
            onProgress?.call(this, {
                status: StatusEnum.FAILURE,
                clientPath,
                serverPath,
                failures
            })
        }
    }

    async downloadFile(clientFile, serverFile, onProgress) {
        const parentPath = dirname(clientFile)
        await fs.ensureDir(parentPath)
        const sftp = await this.sftp('LONG_SFTP')
        onProgress?.call(this, {
            status: StatusEnum.STARTED,
            clientFile,
            serverFile
        })
        try {
            await this.getFile(clientFile, serverFile, sftp, {
                step: (current, _, total) => {
                    const progress = {
                        status: StatusEnum.IN_PROGRESS,
                        clientFile,
                        serverFile,
                        total,
                        current,
                        percentage: Math.ceil((current * 100) / total)
                    }
                    onProgress?.call(this, progress)
                }
            })
            onProgress?.call(this, {
                status: StatusEnum.SUCCESS,
                clientFile,
                serverFile
            })
        } catch (error) {
            onProgress?.call(this, {
                status: StatusEnum.FAILURE,
                clientFile,
                serverFile,
                error
            })
        }
    }

    async downloadFolder(clientPath, serverPath, onProgress) {
        await fs.ensureDir(clientPath)
        const sftp = await this.sftp()
        const successs = []
        const failures = []
        onProgress?.call(this, {
            status: StatusEnum.STARTED,
            clientPath,
            serverPath
        })
        await this.getDirectory(clientPath, serverPath, {
            sftp,
            recursive: true,
            tick: (clientFile, serverFile, error) => {
                if (error) {
                    failures.push({
                        clientFile,
                        serverFile,
                        error
                    })
                } else {
                    successs.push({
                        clientFile,
                        serverFile
                    })
                }
                onProgress?.call(this, {
                    status: StatusEnum.IN_PROGRESS,
                    clientFile,
                    serverFile,
                    error
                })
            }
        })
        if (failures.length == 0) {
            onProgress?.call(this, {
                status: StatusEnum.SUCCESS,
                clientPath,
                serverPath,
                successs
            })
        } else if (successs.length > 0) {
            onProgress?.call(this, {
                status: StatusEnum.PARTIAL_FAILURE,
                clientPath,
                serverPath,
                successs,
                failures
            })
        } else {
            onProgress?.call(this, {
                status: StatusEnum.FAILURE,
                clientPath,
                serverPath,
                failures
            })
        }
    }

    async utimes(serverFile, lstAccessTime, lastUpdateTime) {
        const sftp = await this.sftp()
        return await new Promise((resolve, reject) => {
            sftp.utimes(serverFile, lstAccessTime, lastUpdateTime, error => {
                if (error) {
                    return reject(error)
                }
                resolve()
            })
        })
    }

    async clientSyncToServer(clientFile, serverFile, options) {
        let { chunkSize, isBackup = true } = options || {}
        if (isBackup) {
            const stat = await this.stat(serverFile)
            const timestamp = this.unixSecondFormat(stat.mtime, 'yyyyMMddHHmmss')
            const backup = this.attachSuffixToFilePath(serverFile, '-同步备份-' + timestamp)
            await this.copy(serverFile, backup)
        }
        chunkSize = chunkSize || 5 * 1024 * 1024
        const client = await this.computeClientFileChunkHashCode(clientFile, chunkSize)
        const clientChunks = client.hashCodes
        const server = await this.computeServerFileChunkHashCode(serverFile, chunkSize)
        const serverChunks = server.hashCodes
        const chunks = []
        for (let i = 0; i < clientChunks.length; i++) {
            const it = clientChunks[i]
            if (i < serverChunks.length) {
                if (it.hashCode == serverChunks[i].hashCode) {
                    continue
                }
            }
            chunks.push(it)
        }
        if (chunks.length > 0) {
            const serverFd = await this.open(serverFile, 'w')
            const clientFd = await fs.open(clientFile, 'r')
            for (const chunk of chunks) {
                const size = chunk.end - chunk.start
                const buffer = Buffer.alloc(size)
                const data = await fs.read(clientFd, buffer, 0, size, chunk.start)
                await this.write(serverFd, data.buffer, chunk.start)
            }
        }
        if (server.size > client.size) {
            await this.truncate(serverFile, server.size)
        }
        const sftp = await this.sftp()
        await sftp.utimes(serverFile, client.atime, client.mtime)
    }

    async serverSyncToClient(clientFile, serverFile, options) {
        let { chunkSize, isBackup = true } = options || {}
        if (isBackup) {
            const stat = await fs.stat(clientFile)
            const timestamp = this.unixSecondFormat(stat.mtime, 'yyyyMMddHHmmss')
            const backup = this.attachSuffixToFilePath(clientFile, '-同步备份-' + timestamp)
            await fs.copy(clientFile, backup)
        }
        chunkSize = chunkSize || 5 * 1024 * 1024
        const client = await this.computeClientFileChunkHashCode(clientFile, chunkSize)
        const clientChunks = client.hashCodes
        const server = await this.computeServerFileChunkHashCode(serverFile, chunkSize)
        const serverChunks = server.hashCodes
        const chunks = []
        for (let i = 0; i < serverChunks.length; i++) {
            const it = serverChunks[i]
            if (i < clientChunks.length) {
                if (it.hashCode == clientChunks[i].hashCode) {
                    continue
                }
            }
            chunks.push({
                path: it.path,
                position: i * chunkSize
            })
        }
        if (chunks.length > 0) {
            const fd = await fs.open(clientFile, 'w')
            for (const chunk of chunks) {
                const data = await this.readFile(chunk.path)
                await fs.write(fd, data, 0, data.length, chunk.position)
            }
        }
        if (client.size > server.size) {
            await fs.truncate(clientFile, server.size)
        }
        await fs.utimes(clientFile, server.atime, server.mtime)
    }

    async zip(serverPath) {
        const path = dirname(serverPath)
        const name = basename(serverPath)
        const command = format('tar -czvf "%s.tar.gz" -C "%s" "%s"', serverPath, path, name)
        return await this.execute(command)
    }

    async unzip(serverPath, isRemove) {
        const removeCommand = isRemove ? format('&& rm %s', serverPath) : ''
        const path = dirname(serverPath)
        const command = format('tar -xzvf "%s" -C "%s" %s', serverPath, path, removeCommand)
        return await this.execute(command)
    }

    async isFileChanged(clientFile, serverFile, compare) {
        compare = compare || IsChangedEnum.MTIME | IsChangedEnum.SIZE
        const serverStat = await this.stat(serverFile)
        const clientStat = await fs.stat(clientFile)
        let changed = false
        if (IsChangedEnum.has(compare, IsChangedEnum.MTIME)) {
            const mtime = Math.floor(clientStat.mtimeMs / 1000)
            if (serverStat.mtime != mtime) {
                changed = true
            }
        }
        if (IsChangedEnum.has(compare, IsChangedEnum.SIZE)) {
            if (serverStat.size != clientStat.size) {
                changed = true
            }
        }
        return changed
    }

    async computeServerFileChunkHashCode(serverFile, chunkSize) {
        const stats = await this.stat(serverFile)
        const prefix = 'chunk_'
        const remoteName = basename(serverFile)
        const remotePath = dirname(serverFile)
        const chunkPath = posix.join(remotePath, remoteName + '_' + chunkSize)
        await this.ensurePath(chunkPath)
        const chunkFile = posix.join(chunkPath, prefix)
        const command = format(
            'split -b %s %s %s && for f in %s*; do sha256sum $f; done',
            chunkSize,
            serverFile,
            chunkFile,
            chunkFile
        )
        const text = await this.execute(command)
        const hashCodes = text.split('\n').map(it => {
            const parts = it.split('  ')
            return {
                hashCode: parts[0],
                path: parts[1]
            }
        })
        return {
            size: stats.size,
            mtime: stats.mtime,
            atime: stats.atime,
            hashCodes
        }
    }

    async computeClientFileChunkHashCode(filePath, chunkSize) {
        const stats = await fs.stat(filePath)
        const chunks = this.toChunk(stats.size, chunkSize)
        const fd = await fs.open(filePath, 'r')
        const hashCodes = []
        for (const chunk of chunks) {
            const size = chunk.end - chunk.start
            const buffer = Buffer.alloc(size)
            const result = await fs.read(fd, buffer, 0, buffer.length, chunk.start)
            const hash = crypto.createHash('sha256')
            hash.update(result.buffer)
            chunk.hashCode = hash.digest('hex')
            hashCodes.push(chunk)
        }
        return {
            size: stats.size,
            mtime: Math.floor(stats.mtimeMs / 1000),
            atime: Math.floor(stats.atimeMs / 1000),
            hashCodes
        }
    }

    async uploadPublicKeyPair(publicKey, { logger }) {
        try {
            const key = publicKey.trim()
            logger?.inf('待上传公钥... ')
            logger?.inf(key)
            const sftp = await this.sftp()
            const temp = join(os.tmpdir(), String(Date.now()) + '.txt')
            const home = await this.execCommand('eval echo ~')
            const authorized_keys = posix.join(home.stdout, '.ssh', 'authorized_keys')
            logger?.inf('公钥验证中 ...')
            await this.getFile(temp, authorized_keys, sftp)
            const text = await fs.readFile(temp, {
                encoding: 'utf-8'
            })
            if (text.indexOf(key) == -1) {
                logger?.inf('公钥开始写入 ...')
                const command = format('echo "%s" >> ~/.ssh/authorized_keys', key)
                await this.execCommand(command)
                logger?.inf('写入完成, 登录公钥设置完成。')
            } else {
                logger?.inf('服务器已存在此公钥, 登录公钥设置完成。')
            }
        } catch (error) {
            logger?.inf(error.message)
        }
    }

    async checkUpdateLocalCache(serverPath) {
        const serverStat = await this.stat(serverPath)
        const clientPath = this.clientCachePath(serverPath)
        const state = {
            isPath: serverStat.isDirectory()
        }
        if (await fs.pathExists(clientPath)) {
            const clientStat = await fs.stat(clientPath)
            if (serverStat.isDirectory() && clientStat.isDirectory()) {
                if (clientStat.mtime == serverStat.mtime) {
                    return state
                }
            } else if (clientStat.isFile() && clientStat.isFile()) {
                if (clientStat.mtime == serverStat.mtime) {
                    return state
                }
            } else {
                await fs.remove(clientPath)
            }
        }
        if (serverStat.isDirectory()) {
            await this.downloadFolder(clientPath, serverPath)
        } else {
            await this.downloadFile(clientPath, serverPath)
        }
        await fs.utimes(clientPath, serverStat.atime * 1000, serverStat.mtime * 1000)
        return state
    }

    async forwardToServerPort(clientPort, serverPort, serverSock) {
        const { host, username } = this.options
        const command = 'ssh'
        const port = format('%s:%s:%s', clientPort, serverSock || host, serverPort)
        const server = format('%s@%s', username, host)
        const args = ['-L', port, server]
        return spawn(command, args)
    }

    async forwardToClientPort(clientPort, serverPort) {
        const { host, username } = this.options
        const command = 'ssh'
        const port = format('%s:%s:%s', serverPort, '0.0.0.0', clientPort)
        const server = format('%s@%s', username, host)
        const args = ['-R', port, server]
        return spawn(command, args)
    }

    async forward(clientPort, serverPort, isIn, serverSock) {
        if (isIn) {
            return await this.forwardToClientPort(clientPort, serverPort)
        }
        return await this.forwardToServerPort(clientPort, serverPort, serverSock)
    }

    onClose() {
        this.emitter.emit('close', this.options, this.isUserClosed)
        if (this.isUserClosed || !this.options.isAutoConnect) {
            return
        }
        this.reconnect()
    }

    async startListening() {
        this.connection.on('close', () => this.onClose())
        this.connection.on('error', error => {
            this.isConnected() || this.onClose()
            this.emitter.emit('error', error, this.options)
        })
    }

    async connect(options) {
        try {
            this.trashcanPath = options.trashcanPath || this.trashcanPath
            const temp = options.root || join(os.homedir(), '.ssh-server')
            this.clientCacheRootPath = join(temp, options.host)
            this.logPath = join(temp, 'logs', options.host)
            await super.connect(options)
            await this.ensureTrashcan(this.trashcanPath)
            await this.ensurePath(this.clientCacheRootPath)
            this.options = _.clone(options)
            this.isUserClosed = false
            this.startListening()
            this.emitter.emit('open', this.options)
            return this
        } catch (error) {
            let custom = new ConnectError(error)
            this.emitter.emit('error', custom, this.options)
            throw error
        }
    }

    async sleep(ms) {
        await new Promise(resolve => setTimeout(resolve, ms))
    }

    async reconnect() {
        this.#sftpCache.clear()
        for (let i = 1; i <= this.maxTryCount; i++) {
            this.emitter.emit('reconnect', this.options, i)
            try {
                return await this.connect(this.options)
            } catch (error) {
                let custom = new ReconnectError(error)
                this.emitter.emit('error', custom, this.options, i)
                if (i == this.maxTryCount) {
                    custom = new MaxRetriesExceededError(error)
                    this.emitter.emit('error', custom, this.options, i)
                    throw custom
                }
                const ms = Math.pow(2, i) * 5000
                await this.sleep(ms)
            }
        }
    }

    static async connect(options) {
        const ssh = new SSHClient()
        return await ssh.connect(options)
    }
}

module.exports = SSHClient
