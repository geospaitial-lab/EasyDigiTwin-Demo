import * as THREE from 'three';
import { Ray } from './Ray.js';
import { Hit } from './Hit.js';

export class Raycaster {

    constructor(origin, direction) {
        this.ray = new Ray(origin, direction);
    }

    setFromCameraAndScreenPosition = function() {

        const ndcCoords = new THREE.Vector2();

        return function(camera, screenPosition, screenDimensions) {
            ndcCoords.x = screenPosition.x / screenDimensions.x * 2.0 - 1.0;
            ndcCoords.y = (screenDimensions.y - screenPosition.y) / screenDimensions.y * 2.0 - 1.0;
            if (camera.isPerspectiveCamera) {
                this.ray.origin.setFromMatrixPosition(camera.matrixWorld);
                this.ray.direction.set(ndcCoords.x, ndcCoords.y, 0.5 ).unproject(camera).sub(this.ray.origin).normalize();
                this.camera = camera;
            } else if (camera.isOrthographicCamera) {
                this.ray.origin.set(screenPosition.x, screenPosition.y,
                                   (camera.near + camera.far) / (camera.near - camera.far)).unproject(camera);
                this.ray.direction.set(0, 0, -1).transformDirection(camera.matrixWorld);
                this.camera = camera;
            } else {
                throw new Error('Raycaster::setFromCameraAndScreenPosition() -> Unsupported camera type');
            }
        };

    }();

    intersectSplatMesh = function() {

        const toLocal = new THREE.Matrix4();
        const fromLocal = new THREE.Matrix4();
        const sceneTransform = new THREE.Matrix4();
        const localRay = new Ray();

        return function(splatMesh, outHits = []) {
            const splatTree = splatMesh.getSplatTree();

            for (let s = 0; s < splatTree.subTrees.length; s++) {
                const subTree = splatTree.subTrees[s];

                fromLocal.copy(splatMesh.matrixWorld);
                splatMesh.getSceneTransform(s, sceneTransform);
                fromLocal.multiply(sceneTransform);
                toLocal.copy(fromLocal).invert();

                localRay.origin.copy(this.ray.origin).applyMatrix4(toLocal);
                localRay.direction.copy(this.ray.direction).transformDirection(toLocal);

                const outHitsForSubTree = [];
                if (subTree.rootNode) {
                    this.castRayAtSplatTreeNode(localRay, splatTree, subTree.rootNode, outHitsForSubTree);
                }

                outHitsForSubTree.forEach((hit) => {
                    hit.origin.applyMatrix4(fromLocal);
                    hit.normal.transformDirection(fromLocal);
                });

                outHits.push(...outHitsForSubTree);
            }

            outHits.sort((a, b) => {
                if (a.distance > b.distance) return 1;
                else return -1;
            });

            return outHits;
        };

    }();

    castRayAtSplatTreeNode = function() {

        const tempColor = new THREE.Vector4();
        const tempCenter = new THREE.Vector3();
        const tempScale = new THREE.Vector3();
        const tempRotation = new THREE.Quaternion();
        const tempHit = new Hit();
        const scaleEpsilon = 0.0000001;

        // Used for raycasting against splat ellipsoid

        const origin = new THREE.Vector3(0, 0, 0);
        const tempTransform = new THREE.Matrix4();
        const uniformScaleMatrix = new THREE.Matrix4();
        const toSphereSpace = new THREE.Matrix4();
        const fromSphereSpace = new THREE.Matrix4();
        const tempPoint = new THREE.Vector3();
        const tempRay = new Ray();

        return function(ray, splatTree, node, outHits = []) {
            if (!ray.intersectBox(node.boundingBox)) {
                return;
            }
            if (node.data.indexes && node.data.indexes.length > 0) {
                for (let i = 0; i < node.data.indexes.length; i++) {
                    const splatGlobalIndex = node.data.indexes[i];
                    splatTree.splatMesh.getSplatColor(splatGlobalIndex, tempColor, false);
                    splatTree.splatMesh.getSplatCenter(splatGlobalIndex, tempCenter, false);
                    splatTree.splatMesh.getSplatScaleAndRotation(splatGlobalIndex, tempScale, tempRotation, false);

                    if (tempScale.x <= scaleEpsilon || tempScale.y <= scaleEpsilon || tempScale.z <= scaleEpsilon) {
                        continue;
                    }

                    // Simple approximated sphere intersection
                    /*const radius = (tempScale.x + tempScale.y + tempScale.z) / 3;
                    if (ray.intersectSphere(tempCenter, radius, tempHit)) {
                        const hitClone = tempHit.clone();
                        hitClone.splatIndex = splatGlobalIndex;
                        outHits.push(hitClone);
                    }*/

                    // Raycast against actual splat ellipsoid ... doesn't actually work as well
                    // as the approximated sphere approach
                    tempTransform.compose(origin, tempRotation, tempScale);
                    const uniformScale = Math.log10(tempColor.w) * 2.0;
                    uniformScaleMatrix.makeScale(uniformScale, uniformScale, uniformScale);
                    fromSphereSpace.copy(tempTransform).premultiply(uniformScaleMatrix);
                    toSphereSpace.copy(fromSphereSpace).invert();
                    tempRay.origin.copy(this.ray.origin).sub(tempCenter).applyMatrix4(toSphereSpace);
                    tempRay.direction.copy(this.ray.origin).add(this.ray.direction).sub(tempCenter).applyMatrix4(toSphereSpace).sub(tempRay.origin).normalize();
                   // tempRay.direction.copy(this.ray.direction).transformDirection(toSphereSpace).normalize();
                    if (tempRay.intersectSphere(origin, 1.0, tempHit)) {
                        const hitClone = tempHit.clone();
                        hitClone.splatIndex = splatGlobalIndex;
                        hitClone.origin.applyMatrix4(fromSphereSpace).add(tempCenter);
                        hitClone.distance = tempPoint.copy(hitClone.origin).sub(this.ray.origin).length();
                        outHits.push(hitClone);
                    }
                    

                }
             }
            if (node.children && node.children.length > 0) {
                for (let child of node.children) {
                    this.castRayAtSplatTreeNode(ray, splatTree, child, outHits);
                }
            }
            return outHits;
        };

    }();
}
