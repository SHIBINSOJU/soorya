const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function clone(obj) {
    if (obj === undefined || obj === null) return obj;
    return JSON.parse(JSON.stringify(obj));
}

function getByPath(obj, dotPath) {
    if (!obj || typeof obj !== 'object') return undefined;
    const parts = dotPath.split('.');
    let curr = obj;
    for (const p of parts) {
        if (curr === undefined || curr === null) return undefined;
        curr = curr[p];
    }
    return curr;
}

function setByPath(obj, dotPath, val) {
    if (!obj || typeof obj !== 'object') return;
    const parts = dotPath.split('.');
    let curr = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (curr[p] === undefined || curr[p] === null || typeof curr[p] !== 'object') {
            curr[p] = {};
        }
        curr = curr[p];
    }
    curr[parts[parts.length - 1]] = val;
}

function matchDoc(doc, filter) {
    if (!filter || typeof filter !== 'object') return true;

    for (const [key, condition] of Object.entries(filter)) {
        if (key.startsWith('$')) continue;

        let docVal = getByPath(doc, key);
        if (key === '_id' && docVal === undefined && doc.id) {
            docVal = doc.id;
        }

        if (condition !== null && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
            // Operator conditions
            if ('$in' in condition) {
                const list = condition.$in;
                if (!Array.isArray(list) || !list.includes(docVal)) return false;
            }
            if ('$ne' in condition) {
                if (docVal === condition.$ne) return false;
            }
            const toCompareVal = (v) => {
                if (v instanceof Date) return v.getTime();
                if (typeof v === 'string' && !isNaN(Date.parse(v)) && isNaN(Number(v))) return new Date(v).getTime();
                const n = Number(v);
                return isNaN(n) ? v : n;
            };

            if ('$lte' in condition) {
                if (toCompareVal(docVal) > toCompareVal(condition.$lte)) return false;
            }
            if ('$gte' in condition) {
                if (toCompareVal(docVal) < toCompareVal(condition.$gte)) return false;
            }
            if ('$lt' in condition) {
                if (toCompareVal(docVal) >= toCompareVal(condition.$lt)) return false;
            }
            if ('$gt' in condition) {
                if (toCompareVal(docVal) <= toCompareVal(condition.$gt)) return false;
            }
        } else {
            // Equality check
            if (key === '_id' || key === 'id') {
                if (String(docVal) !== String(condition)) return false;
            } else if (condition instanceof Date) {
                if (new Date(docVal).getTime() !== condition.getTime()) return false;
            } else if (docVal !== condition) {
                return false;
            }
        }
    }
    return true;
}

function applyUpdate(doc, update) {
    if (!update || typeof update !== 'object') return doc;

    let hasOperators = false;
    for (const key of Object.keys(update)) {
        if (key.startsWith('$')) {
            hasOperators = true;
            break;
        }
    }

    if (!hasOperators) {
        for (const [key, val] of Object.entries(update)) {
            setByPath(doc, key, val);
        }
    } else {
        if (update.$set) {
            for (const [key, val] of Object.entries(update.$set)) {
                setByPath(doc, key, val);
            }
        }
        if (update.$inc) {
            for (const [key, val] of Object.entries(update.$inc)) {
                const current = Number(getByPath(doc, key)) || 0;
                setByPath(doc, key, current + Number(val));
            }
        }
        if (update.$push) {
            for (const [key, val] of Object.entries(update.$push)) {
                let arr = getByPath(doc, key);
                if (!Array.isArray(arr)) {
                    arr = [];
                    setByPath(doc, key, arr);
                }
                arr.push(val);
            }
        }
        if (update.$pull) {
            for (const [key, val] of Object.entries(update.$pull)) {
                let arr = getByPath(doc, key);
                if (Array.isArray(arr)) {
                    if (val && typeof val === 'object') {
                        arr = arr.filter(item => !matchDoc(item, val));
                    } else {
                        arr = arr.filter(item => item !== val);
                    }
                    setByPath(doc, key, arr);
                }
            }
        }
        if (update.$addToSet) {
            for (const [key, val] of Object.entries(update.$addToSet)) {
                let arr = getByPath(doc, key);
                if (!Array.isArray(arr)) {
                    arr = [];
                    setByPath(doc, key, arr);
                }
                if (!arr.includes(val)) {
                    arr.push(val);
                }
            }
        }
    }

    doc.updatedAt = new Date().toISOString();
    return doc;
}

class Query {
    constructor(execFn) {
        this._exec = execFn;
        this._sort = null;
        this._skip = 0;
        this._limit = null;
    }

    sort(sortObj) {
        this._sort = sortObj;
        return this;
    }

    skip(n) {
        this._skip = Number(n) || 0;
        return this;
    }

    limit(n) {
        this._limit = Number(n) || null;
        return this;
    }

    lean() {
        return this;
    }

    async then(resolve, reject) {
        try {
            let res = await this._exec();
            if (Array.isArray(res)) {
                if (this._sort && typeof this._sort === 'object') {
                    res.sort((a, b) => {
                        for (const [field, dir] of Object.entries(this._sort)) {
                            const valA = getByPath(a, field);
                            const valB = getByPath(b, field);
                            if (valA < valB) return dir > 0 ? -1 : 1;
                            if (valA > valB) return dir > 0 ? 1 : -1;
                        }
                        return 0;
                    });
                }
                if (this._skip > 0) {
                    res = res.slice(this._skip);
                }
                if (this._limit !== null && this._limit >= 0) {
                    res = res.slice(0, this._limit);
                }
            }
            resolve(res);
        } catch (err) {
            reject(err);
        }
    }
}

class LocalStore {
    constructor(filename) {
        this.filename = filename;
        this.dataDir = path.join(process.cwd(), 'data');
        this.filePath = path.join(this.dataDir, `${filename}.json`);
        this.docs = [];
        this.load();
    }

    load() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        if (fs.existsSync(this.filePath)) {
            try {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                this.docs = JSON.parse(raw);
                if (!Array.isArray(this.docs)) this.docs = [];
            } catch {
                this.docs = [];
            }
        } else {
            this.docs = [];
            this.save();
        }
    }

    save() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
            const tmpPath = `${this.filePath}.tmp`;
            fs.writeFileSync(tmpPath, JSON.stringify(this.docs, null, 2), 'utf-8');
            fs.renameSync(tmpPath, this.filePath);
        } catch (err) {
            console.error(`LocalStore save error for ${this.filename}:`, err.message);
        }
    }

    find(filter = {}) {
        return new Query(async () => {
            const matches = this.docs.filter(d => matchDoc(d, filter));
            return clone(matches);
        });
    }

    findOne(filter = {}) {
        return new Query(async () => {
            const item = this.docs.find(d => matchDoc(d, filter));
            if (!item) return null;
            const res = clone(item);
            res.save = async () => {
                const idx = this.docs.findIndex(d => d._id === item._id);
                if (idx !== -1) {
                    this.docs[idx] = clone(res);
                    this.save();
                }
                return res;
            };
            res.toObject = () => clone(res);
            return res;
        });
    }

    findById(id) {
        return this.findOne({ _id: id });
    }

    async create(data) {
        const now = new Date().toISOString();
        const doc = {
            _id: data._id || crypto.randomBytes(12).toString('hex'),
            createdAt: now,
            updatedAt: now,
            ...clone(data)
        };
        doc.toObject = () => clone(doc);
        this.docs.push(doc);
        this.save();
        return clone(doc);
    }

    async countDocuments(filter = {}) {
        return this.docs.filter(d => matchDoc(d, filter)).length;
    }

    findOneAndUpdate(filter, update, options = {}) {
        return new Query(async () => {
            let doc = this.docs.find(d => matchDoc(d, filter));
            if (!doc) {
                if (options.upsert) {
                    const now = new Date().toISOString();
                    const newDoc = {
                        _id: crypto.randomBytes(12).toString('hex'),
                        createdAt: now,
                        updatedAt: now
                    };
                    for (const [k, v] of Object.entries(filter)) {
                        if (!k.startsWith('$') && typeof v !== 'object') {
                            setByPath(newDoc, k, v);
                        }
                    }
                    applyUpdate(newDoc, update);
                    this.docs.push(newDoc);
                    this.save();
                    return clone(newDoc);
                }
                return null;
            }

            const original = clone(doc);
            applyUpdate(doc, update);
            this.save();
            return options.returnDocument === 'after' ? clone(doc) : original;
        });
    }

    findByIdAndUpdate(id, update, options = {}) {
        return this.findOneAndUpdate({ _id: id }, update, options);
    }

    findOneAndDelete(filter) {
        return new Query(async () => {
            const idx = this.docs.findIndex(d => matchDoc(d, filter));
            if (idx === -1) return null;
            const removed = this.docs.splice(idx, 1)[0];
            this.save();
            return clone(removed);
        });
    }

    findByIdAndDelete(id) {
        return this.findOneAndDelete({ _id: id });
    }
}

// Stores registry: one LocalStore instance per collection
const stores = new Map();

function getStore(name) {
    if (!stores.has(name)) {
        stores.set(name, new LocalStore(name));
    }
    return stores.get(name);
}

module.exports = {
    LocalStore,
    getStore
};
