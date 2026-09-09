import * as T from "three";
export type ArmPose = { raise: number; forward: number; bend: number };
export type Pose = { left: ArmPose; right: ArmPose };
export const neutralPose: Pose = {
  left: { raise: 0, forward: 0, bend: 0 },
  right: { raise: 0, forward: 0, bend: 0 },
};
export function armRig(
  side: number,
  shoulderX: number,
  shoulderY: number,
  length: number,
  pose: ArmPose,
) {
  const shoulder = new T.Vector3(
    side * (shoulderX - 0.015),
    shoulderY - 0.025,
    0,
  );
  const upper = new T.Vector3(side * 0.37, -Math.sqrt(1 - 0.37 ** 2), 0);
  const lower = new T.Vector3(side * 0.25, -Math.sqrt(1 - 0.25 ** 2), 0);
  const rotation = new T.Quaternion().setFromEuler(
    new T.Euler(
      (-pose.forward * Math.PI) / 180,
      0,
      (side * pose.raise * Math.PI) / 180,
      "ZYX",
    ),
  );
  const bend = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(-1, 0, 0),
    (pose.bend * Math.PI) / 180,
  );
  const elbow0 = shoulder.clone().addScaledVector(upper, length * 0.5);
  const elbow = shoulder.clone().add(
    upper
      .clone()
      .applyQuaternion(rotation)
      .multiplyScalar(length * 0.5),
  );
  const lowerRotation = rotation.clone().multiply(bend);
  const wrist = elbow.clone().add(
    lower
      .clone()
      .applyQuaternion(lowerRotation)
      .multiplyScalar(length * 0.5),
  );
  const transform = (p: T.Vector3) => {
    const along = p.clone().sub(shoulder).dot(upper);
    const w = T.MathUtils.smoothstep(along, length * 0.42, length * 0.58);
    const a = p.clone().sub(shoulder).applyQuaternion(rotation).add(shoulder);
    const b = p.clone().sub(elbow0).applyQuaternion(lowerRotation).add(elbow);
    return a.lerp(b, w);
  };
  return { shoulder, elbow, wrist, transform };
}
