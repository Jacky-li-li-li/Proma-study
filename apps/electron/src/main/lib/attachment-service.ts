/**
 * 附件存储服务
 *
 * 负责文件附件的本地存储、读取和删除。
 * 存储路径：~/.proma/attachments/{conversationId}/{uuid}.ext
 *
 * - 保存：base64 解码 → 写入文件
 * - 读取：文件 → base64 编码（用于 API 发送）
 * - 删除：单个文件或整个对话附件目录
 * - 文件选择对话框：Electron dialog → 读取选中文件
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, rmSync, statSync } from 'node:fs'
import { extname, basename, join, isAbsolute, normalize, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dialog, BrowserWindow } from 'electron'
import {
  getConfigDir,
  getConversationAttachmentsDir,
  getAgentWorkspacesDir,
  resolveAttachmentPath,
} from './config-paths'
import type {
  FileAttachment,
  AttachmentSaveInput,
  AttachmentSaveResult,
  FileDialogResult,
} from '@proma/shared'

/** 支持的图片 MIME 类型 */
const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

/** 扩展名 → MIME 类型映射 */
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
}

/** 消息内联图片读取的最大文件大小（20MB） */
const INLINE_IMAGE_MAX_SIZE = 20 * 1024 * 1024

function isUnderRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = normalize(targetPath)
  const normalizedRoot = normalize(rootPath)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
}

function isImagePath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  const mime = getMimeType(ext)
  return mime.startsWith('image/')
}

/** 文件选择对话框支持的过滤器 */
const FILE_FILTERS = [
  {
    name: '支持的文件',
    extensions: [
      'png', 'jpg', 'jpeg', 'gif', 'webp',
      'pdf', 'txt', 'md', 'json', 'csv', 'xml', 'html',
      'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'odt', 'odp', 'ods',
    ],
  },
  {
    name: '所有文件',
    extensions: ['*'],
  },
]

/**
 * 判断是否为图片附件
 */
export function isImageAttachment(mediaType: string): boolean {
  return IMAGE_MIME_TYPES.has(mediaType)
}

/**
 * 根据扩展名获取 MIME 类型
 */
export function getMimeType(ext: string): string {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  return MIME_MAP[normalized] || 'application/octet-stream'
}

/**
 * 保存附件到本地
 *
 * 将 base64 编码的文件数据解码后写入
 * ~/.proma/attachments/{conversationId}/{uuid}.ext
 *
 * @param input 保存附件参数
 * @returns 保存结果，包含附件元信息
 */
export function saveAttachment(input: AttachmentSaveInput): AttachmentSaveResult {
  const { conversationId, filename, mediaType, data } = input

  // 确保目录存在
  const dir = getConversationAttachmentsDir(conversationId)

  // 生成唯一文件名
  const ext = extname(filename) || '.bin'
  const id = randomUUID()
  const storedFilename = `${id}${ext}`
  const localPath = `${conversationId}/${storedFilename}`
  const fullPath = join(dir, storedFilename)

  // base64 解码并写入
  const buffer = Buffer.from(data, 'base64')
  writeFileSync(fullPath, buffer)

  const attachment: FileAttachment = {
    id,
    filename,
    mediaType,
    localPath,
    size: buffer.length,
  }

  console.log(`[附件服务] 已保存附件: ${filename} → ${localPath} (${buffer.length} 字节)`)
  return { attachment }
}

/**
 * 读取附件并返回 base64 编码
 *
 * 支持两种路径格式：
 * 1. 相对路径 {conversationId}/{uuid}.ext → 解析到 ~/.proma/attachments/
 * 2. 绝对路径（Agent 工作区附件）→ 需在 ~/.proma/ 目录下，直接读取
 *
 * @param localPath 相对路径或绝对路径
 * @returns base64 编码的文件数据
 */
export function readAttachmentAsBase64(localPath: string): string {
  let fullPath: string

  if (isAbsolute(localPath)) {
    // 绝对路径：验证在 ~/.proma/ 目录下，防止路径穿越
    const configDir = getConfigDir()
    const normalized = normalize(localPath)
    if (!normalized.startsWith(configDir)) {
      throw new Error(`附件路径不在安全目录内: ${localPath}`)
    }
    fullPath = normalized
  } else {
    fullPath = resolveAttachmentPath(localPath)
  }

  if (!existsSync(fullPath)) {
    throw new Error(`附件文件不存在: ${localPath}`)
  }

  const buffer = readFileSync(fullPath)
  return buffer.toString('base64')
}

/**
 * 读取消息里引用的本地图片，返回 data URL
 *
 * 支持：
 * - 绝对路径
 * - 相对路径（优先 basePath，其次 process.cwd()）
 *
 * 安全限制：
 * - 仅允许读取图片类型
 * - 仅允许读取配置目录、Agent 工作区目录、当前进程工作目录及 basePath 下的文件
 */
export function readLocalImageAsDataUrl(imagePath: string, basePath?: string): string | null {
  const trimmed = imagePath.trim()
  if (!trimmed) return null

  const candidates: string[] = []
  if (isAbsolute(trimmed)) {
    candidates.push(resolve(trimmed))
  } else {
    if (basePath && isAbsolute(basePath)) {
      candidates.push(resolve(basePath, trimmed))
    }
    candidates.push(resolve(process.cwd(), trimmed))
    candidates.push(resolve(getConfigDir(), trimmed))
  }

  const allowedRoots = [
    resolve(getConfigDir()),
    resolve(getAgentWorkspacesDir()),
    resolve(process.cwd()),
    resolve(homedir()),
  ]
  if (basePath && isAbsolute(basePath)) {
    allowedRoots.push(resolve(basePath))
  }

  for (const candidate of candidates) {
    if (!allowedRoots.some((root) => isUnderRoot(candidate, root))) continue
    if (!existsSync(candidate)) continue
    if (!isImagePath(candidate)) continue

    const stat = statSync(candidate)
    if (!stat.isFile()) continue
    if (stat.size > INLINE_IMAGE_MAX_SIZE) continue

    const buffer = readFileSync(candidate)
    const mime = getMimeType(extname(candidate))
    return `data:${mime};base64,${buffer.toString('base64')}`
  }

  return null
}

/**
 * 删除单个附件
 *
 * @param localPath 相对路径 {conversationId}/{uuid}.ext
 */
export function deleteAttachment(localPath: string): void {
  const fullPath = resolveAttachmentPath(localPath)

  if (existsSync(fullPath)) {
    try {
      unlinkSync(fullPath)
      console.log(`[附件服务] 已删除附件: ${localPath}`)
    } catch (error) {
      console.warn(`[附件服务] 删除附件失败: ${localPath}`, error)
    }
  }
}

/**
 * 删除对话的全部附件
 *
 * 删除整个 ~/.proma/attachments/{conversationId}/ 目录。
 *
 * @param conversationId 对话 ID
 */
export function deleteConversationAttachments(conversationId: string): void {
  const dir = join(resolveAttachmentPath(''), conversationId)

  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true })
      console.log(`[附件服务] 已删除对话附件目录: ${conversationId}`)
    } catch (error) {
      console.warn(`[附件服务] 删除对话附件目录失败: ${conversationId}`, error)
    }
  }
}

/**
 * 打开文件选择对话框
 *
 * 弹出 Electron 文件选择对话框，支持多选，
 * 读取选中的文件并返回 base64 编码数据。
 *
 * @returns 选中的文件列表
 */
export async function openFileDialog(): Promise<FileDialogResult> {
  // macOS 上必须传入父窗口，否则对话框可能出现在应用窗口后面
  const parentWindow = BrowserWindow.getFocusedWindow()
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: FILE_FILTERS,
  }

  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled || result.filePaths.length === 0) {
    return { files: [] }
  }

  const files = result.filePaths.map((filePath) => {
    const buffer = readFileSync(filePath)
    const filename = basename(filePath)
    const ext = extname(filePath)
    const mediaType = getMimeType(ext)

    return {
      filename,
      mediaType,
      data: buffer.toString('base64'),
      size: buffer.length,
    }
  })

  console.log(`[附件服务] 文件对话框选择了 ${files.length} 个文件`)
  return { files }
}
