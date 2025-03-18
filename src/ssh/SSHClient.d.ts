import { NodeSSH, Config, SSHExecCommandOptions } from 'node-ssh'
import { EventEmitter } from 'events'
import { ClientChannel, SFTPWrapper, Stats } from 'ssh2'

export = SSHClient
declare class SSHClient extends NodeSSH {
    static connect(options: Config): Promise<SSHClient>
    trashcanPath: string
    options: Config
    clientCacheRootPath: string
    maxPath: number
    logPath: string
    isUserClosed: boolean
    emitter: EventEmitter
    maxTryCount: number
    unixSecondFormat(unixSecond: number, format?: string = 'yyyy-MM-dd HH:mm:ss'): string
    attachSuffixToFilePath(filePath: string, suffix: string): string
    toChunk(
        total: number,
        chunkSize: number
    ): {
        start: number
        end: number
        index: number
    }[]
    changeFileExtension(filePath: string, extension: string): string
    clientCachePath(serverPath: string): string
    clientSourcePath(serverPath: string): string
    pathLength(path: string): number
    validatePathOrThrow(path: string): void
    validateNameOrThrow(name: string): void
    isValidName(name: string): boolean
    isValidPath(path: string): boolean
    sftp(tag?: string): Promise<SFTPWrapper>
    stat(serverPath: string): Promise<Stats>
    hasFileCache(serverFile: string): Promise<boolean>
    checkOrUpdateFileCache(serverFile: string, onProgress: any): Promise<void>
    close(): Promise<void>
    shell(): Promise<ClientChannel>
    pwd(): Promise<string>
    cd(path: string, currentPath: string, proviousPath: string): Promise<any>
    execute(command: string, options: SSHExecCommandOptions): Promise<string>
    executeText(
        text: string,
        options: { onOutput: (type: number, msg: string) => void }
    ): Promise<void>
    readPath(serverPath: string): Promise<any>
    copy(clientPath: string, serverPath: string): Promise<void>
    createBackupOfVersion(serverPath: string, isFile: boolean): Promise<void>
    createTimePointBackup(serverPath: string, isFile: boolean): Promise<void>
    move(source: string, target: string): Promise<void>
    merge(
        source: string,
        target: string,
        onMerge: (item: {
            source: string
            sourceStat: Stats
            target: string
            targetStat: Stats
        }) => number
    ): Promise<number>
    remove(path: string): Promise<void>
    removeContent(path: string): Promise<void>
    brotliCompress(text: string): Promise<string>
    brotliDecompress(text: string): Promise<string>
    findAvailableName(serverPath: string, nameFn: any): Promise<any>
    symlink(serverPath: string, linkPath: any): Promise<any>
    realpath(serverPath: string): Promise<any>
    symlinkTarget(serverPath: string): Promise<any>
    ensureTrashcan(path: string): Promise<void>
    removeToTrashcan(remote: any): Promise<void>
    parseMetedata(remote: any): Promise<any>
    write(fd: any, buffer: any, position: any): Promise<any>
    writeFile(serverFile: string, data: any, options: any): Promise<any>
    writeText(serverFile: string, data: any): Promise<any>
    writeJson(serverFile: string, data: any): Promise<any>
    readFile(serverFile: string, options: any): Promise<any>
    readText(serverFile: string): Promise<any>
    readJson(serverFile: string): Promise<any>
    truncate(serverFile: string, length: any): Promise<string>
    rename(sourcePath: any, name: any): Promise<any>
    open(serverFile: string, mode: any): Promise<any>
    exists(remotePath: any): Promise<any>
    ensurePath(path: string): Promise<void>
    upload(client: any, server: any, onProgress: any): Promise<void>
    uploadFile(clientFile: any, serverFile: string, onProgress: any): Promise<void>
    uploadPath(clientPath: string, serverPath: string, onProgress: any): Promise<void>
    downloadFile(clientFile: any, serverFile: string, onProgress: any): Promise<void>
    downloadPath(clientPath: string, serverPath: string, onProgress: any): Promise<void>
    utimes(serverFile: string, lstAccessTime: any, lastUpdateTime: any): Promise<any>
    clientSyncToServer(clientFile: any, serverFile: string, options: any): Promise<void>
    serverSyncToClient(clientFile: any, serverFile: string, options: any): Promise<void>
    zip(serverPath: string): Promise<string>
    unzip(serverPath: string, isRemove: any): Promise<string>
    isFileChanged(clientFile: any, serverFile: string, compare: any): Promise<boolean>
    computeServerFileChunkHashCode(
        serverFile: string,
        chunkSize: any
    ): Promise<{
        size: any
        mtime: any
        atime: any
        hashCodes: {
            hashCode: string
            path: string
        }[]
    }>
    computeClientFileChunkHashCode(
        filePath: any,
        chunkSize: any
    ): Promise<{
        size: any
        mtime: number
        atime: number
        hashCodes: {
            start: number
            end: number
            index: number
        }[]
    }>
    uploadPublicKeyPair(
        publicKey: string,
        {
            logger
        }: {
            logger: any
        }
    ): Promise<void>
    checkUpdateLocalCache(serverPath: string): Promise<{
        isPath: boolean
    }>
    forwardToServerPort(clientPort: any, serverPort: any, serverSock: any): Promise<any>
    forwardToClientPort(clientPort: any, serverPort: any): Promise<any>
    forward(clientPort: any, serverPort: any, isIn: any, serverSock: any): Promise<any>
    onClose(): void
    startListening(): Promise<void>
    connect(options: Config): Promise<this>
    sleep(ms: number): Promise<void>
    reconnect(): Promise<this>
    toProxy(): Promise<Proxy<SSHClient>>
    #private
}
