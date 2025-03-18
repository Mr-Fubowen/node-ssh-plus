const { join } = require('path')
const { SSHClient } = require('../src/index')
const assert = require('assert')

const opts = {
    host: '',
    port: 22,
    password: '',
    username: 'root'
}
describe('SSH 客户端', function () {
    this.timeout(10000)
    let ssh
    before(async function () {
        ssh = await SSHClient.connect(opts)
    })

    it('读取目录', async function () {
        const roots = await ssh.readPath('/')
        ssh.close()
        assert.ok(roots.length > 0, '根目录不为空')
    })
    it('测试代理', async function () {
        const sshProxy = await ssh.toProxy()
        const roots = await sshProxy.readPath('/')
        ssh.close()
        assert.ok(roots.length > 0, '根目录不为空')
    })
})
