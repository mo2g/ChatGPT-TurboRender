/**
 * 统一的 Dataset 管理工具
 * 消除分散在各处的 dataset 设置重复代码
 */

export interface DatasetScope {
  body?: HTMLElement | null;
  documentElement?: HTMLElement | null;
}

export function setDataset(scope: DatasetScope, key: string, value: string | null | undefined): void {
  const normalizedValue = value ?? '';
  if (scope.body) {
    scope.body.dataset[key] = normalizedValue;
  }
  if (scope.documentElement) {
    scope.documentElement.dataset[key] = normalizedValue;
  }
}

export function deleteDataset(scope: DatasetScope, key: string): void {
  if (scope.body) {
    delete scope.body.dataset[key];
  }
  if (scope.documentElement) {
    delete scope.documentElement.dataset[key];
  }
}

// Read Aloud 专用的 dataset key 集合


// Debug action counter keys

