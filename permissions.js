// UI guard hanya untuk pengalaman pengguna. Otorisasi sesungguhnya wajib ditegakkan oleh Firebase Rules/backend.
export function hasRole(user, roles = []) {
  const role = user?.role || user?.claims?.role;
  return roles.includes(role);
}
export function canViewSensitiveCase(user, caseData) {
  if (!user || !caseData) return false;
  const role = user.role || user.claims?.role;
  if (["Ketua Komite", "Sekretaris Komite", "Subkomite Etik dan Disiplin"].includes(role)) return true;
  return Array.isArray(caseData.assignedUids) && caseData.assignedUids.includes(user.uid);
}
