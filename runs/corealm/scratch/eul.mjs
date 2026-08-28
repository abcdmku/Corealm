import * as THREE from 'three';
const o = new THREE.Object3D();
o.rotation.set(Math.PI/2, Math.PI/2, 0);
o.updateMatrix();
const q = new THREE.Quaternion().setFromEuler(o.rotation);
for (const [n,v] of [['X',[1,0,0]],['Y',[0,1,0]],['Z',[0,0,1]]]) {
  const vec = new THREE.Vector3(...v).applyQuaternion(q);
  console.log('euler(PI/2,PI/2,0): asset',n,'->',vec.toArray().map(x=>+x.toFixed(3)).join(','));
}
const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), Math.PI/2)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI/2));
for (const [n,v] of [['X',[1,0,0]],['Y',[0,1,0]],['Z',[0,0,1]]]) {
  const vec = new THREE.Vector3(...v).applyQuaternion(q2);
  console.log('qX*qY: asset',n,'->',vec.toArray().map(x=>+x.toFixed(3)).join(','));
}
const q3 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), Math.PI/2);
for (const [n,v] of [['X',[1,0,0]],['Y',[0,1,0]],['Z',[0,0,1]]]) {
  const vec = new THREE.Vector3(...v).applyQuaternion(q3);
  console.log('qX only: asset',n,'->',vec.toArray().map(x=>+x.toFixed(3)).join(','));
}
// shield: want asset +Z -> local -X, asset +Y -> local +Z
const e = new THREE.Euler(Math.PI/2, -Math.PI/2, 0, 'XYZ');
const q4 = new THREE.Quaternion().setFromEuler(e);
for (const [n,v] of [['X',[1,0,0]],['Y',[0,1,0]],['Z',[0,0,1]]]) {
  const vec = new THREE.Vector3(...v).applyQuaternion(q4);
  console.log('euler(PI/2,-PI/2,0): asset',n,'->',vec.toArray().map(x=>+x.toFixed(3)).join(','));
}
