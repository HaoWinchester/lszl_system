import { request } from './http';
import type { ImageAsset } from '../types/api';

let assetSequence=0;

// Temporary decoded images only; question data and access decisions stay server-owned.
export async function loadQuestionAsset(asset: ImageAsset): Promise<string> {
  if (!/^[\w-]+$/.test(asset.id)) throw new Error('图片标识无效');
  const value = await request<{ mimeType:string; dataBase64:string }>({ path:`/api/v1/question-assets/${encodeURIComponent(asset.id)}/content` });
  const suffix = ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'} as Record<string,string>)[value.mimeType];
  if (!suffix || !value.dataBase64) throw new Error('图片内容无效');
  const target = `${wx.env.USER_DATA_PATH}/question-${asset.id}-${Date.now()}-${++assetSequence}.${suffix}`;
  await new Promise<void>((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:target,data:value.dataBase64,encoding:'base64',success:()=>resolve(),fail:()=>reject(new Error('图片无法显示，请重试'))}));
  return target;
}
export function removeQuestionAsset(path: string) {
  if (path.startsWith(`${wx.env.USER_DATA_PATH}/question-`)) wx.getFileSystemManager().unlink({filePath:path,fail:()=>{}});
}
