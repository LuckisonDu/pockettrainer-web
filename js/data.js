// 内置数据：CIFAR-10 的小子集（5000 训练 + 2000 测试），已经先用预训练 ResNet50 变成 2048 个数字（特征）。
// 文件用 float16 存（省一半体积），读进来再转回 float32。
import { halfToFloat, sha256 } from './util.js';
const base = new URL('../data/', import.meta.url);
export const D = 2048, C = 10;
let cache;
async function get(name) { const r = await fetch(new URL(name, base)); if (!r.ok) throw new Error(name + ' ' + r.status); return new Uint8Array(await r.arrayBuffer()); }

export async function loadBuiltin() {
  return cache ??= (async () => {
    const [tx, ty, vx, vy] = await Promise.all([get('train_x.f16'), get('train_y.u8'), get('test_x.f16'), get('test_y.u8')]);
    return { D, C, trainX: halfToFloat(tx), trainY: ty, testX: halfToFloat(vx), testY: vy, nTrain: ty.length, nTest: vy.length };
  })();
}
// Environment 的 Install 步骤：核对数据文件的 SHA-256（和 dataset.json 里登记的一致才算数）
export async function verifyDataFiles(say) {
  const meta = await (await fetch(new URL('dataset.json', base))).json();
  for (const [name, want] of Object.entries(meta.files)) {
    const got = await sha256(await get(name));
    if (got !== want) throw new Error(`Data file ${name} does not match its checksum`);
    say(`SHA-256 OK: ${name}`);
  }
  return meta.name;
}
