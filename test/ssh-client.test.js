const { join } = require('path')
const { SSHClient } = require('../src/index')
const assert = require('assert')
const mocha = require('mocha')

const opts = {
    host: '121.36.96.142',
    port: 22,
    password: 'Fubowen@471063',
    username: 'root'
}
describe('SSH 客户端', function () {
    this.timeout(10000)
    let ssh
    before(async function () {
        ssh = await SSHClient.connect(opts)
    })

    it('建立连接', async function () {
        const ssh = await SSHClient.connect(opts)
        const roots = await ssh.readPath('/')
        ssh.close()
        assert.ok(roots.length > 0, '根目录不为空')
    })
    it('读取目录', async () => {
        const ssh = await SSHClient.connect(opts)
        const roots = await ssh.ssh.close()
    })
})
