const md5 = require('md5');
class ConsistentHashRing {
    constructor(nodes, virtualNodes = 150) {
        this.ring = [];
        this.nodeMap = new Map();
        this.virtualNodes = virtualNodes;
        for (const node of nodes) {
            this.addNode(node);
        }
        this.ring.sort((a, b) => a.hash - b.hash);
        console.log(`[ConsistentHashRing] Initialized with ${nodes.length} physical nodes, ${this.ring.length} virtual nodes total`);
    }
    addNode(node) {
        this.nodeMap.set(node.name, node);
        for (let i = 0; i < this.virtualNodes; i++) {
            const virtualKey = `${node.name}-vnode-${i}`;
            const hash = this._hash(virtualKey);
            this.ring.push({ hash, nodeName: node.name });
        }
    }
    getNode(key) {
        if (this.ring.length === 0) {
            throw new Error('[ConsistentHashRing] No nodes in the ring!');
        }
        const hash = this._hash(key);
        let low = 0;
        let high = this.ring.length - 1;
        let result = 0; 
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (this.ring[mid].hash >= hash) {
                result = mid;
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }
        if (low > this.ring.length - 1) {
            result = 0;
        }
        const targetNodeName = this.ring[result].nodeName;
        return this.nodeMap.get(targetNodeName);
    }
    _hash(key) {
        const hex = md5(key);
        return parseInt(hex.substring(0, 8), 16);
    }
    getDistribution() {
        const distribution = {};
        for (const vnode of this.ring) {
            distribution[vnode.nodeName] = (distribution[vnode.nodeName] || 0) + 1;
        }
        return distribution;
    }
}
module.exports = ConsistentHashRing;
