# Node SSH Plus

#### 介绍

对 node-ssh 包进行适当的扩展使其更加易用

#### 使用

```js
const opts = {
    host: '',
    port: 22,
    password: '',
    username: 'root'
}
const ssh = await SSHClient.connect(opts)
const roots = await ssh.readPath('/')
// 建立链接的代价是高昂的, 连续使用请保存 SSHClient 实例
// 在完全使用完毕后关闭连接
ssh.close()
```

```js
const opts = {
    host: '',
    port: 22,
    password: '',
    username: 'root'
}
const ssh = await SSHClient.connect(opts)
// 使用 toProxy 方法将会创建 ssh 对象的代理
// 此代理会拦截 async 方法抛出的异常转换为错误事件 Exception 中的 AsyncFunctionError
// 注意: 此代理是为了帮助用户使用自己的方法检测连接的连通性
// node-ssh 底层的 ssh2 库的 close 事件有时候不能实时的反应连接的通断, 会在断网十几分钟后触发，因此
// 使用 toProxy 在用户操作失败后使用自定义方式检测连接的连通性
const sshProxy = await ssh.toProxy()
const roots = await sshProxy.readPath('/')
// 建立链接的代价是高昂的, 连续使用请保存 SSHClient 实例
// 在完全使用完毕后关闭连接
ssh.close()
```

#### 贡献

1.  本仓库同步发布在[Github](https://github.com/Mr-Fubowen/node-ssh-plus)和[码云](https://gitee.com/fu-ws/ssh-node),
2.  有任何问题请提交 Issues
