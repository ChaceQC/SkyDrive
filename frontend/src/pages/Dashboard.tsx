import React, { useState, useEffect, useRef } from 'react';
import { Layout, Menu, Breadcrumb, Button, Table, Upload, message, Modal, Input, Popconfirm, Progress, Card, Space, Checkbox, InputNumber, Typography, Form, Switch, Spin, List, Drawer, Dropdown, Grid, Empty, Avatar, Tooltip, Tabs, Row, Col, DatePicker, Radio } from 'antd';
import {
  FolderOutlined, FileOutlined, UploadOutlined, FolderAddOutlined,
  HomeOutlined, LogoutOutlined, DownloadOutlined, DeleteOutlined,
  ArrowUpOutlined, RestOutlined, UndoOutlined, CloudUploadOutlined,
  PauseCircleOutlined, PlayCircleOutlined, CloseCircleOutlined,
  CloudDownloadOutlined, EyeOutlined, ShareAltOutlined, EditOutlined,
  HddOutlined, SettingOutlined, UserOutlined, CopyOutlined, ScissorOutlined,
  SnippetsOutlined, MenuOutlined, MoreOutlined, FilePdfOutlined,
  FileWordOutlined, FileExcelOutlined, FileImageOutlined, FileTextOutlined,
  FileZipOutlined, VideoCameraOutlined, InboxOutlined, DesktopOutlined,
  LockOutlined, IdcardOutlined, MailOutlined, SafetyCertificateOutlined,
  SyncOutlined, ClearOutlined, ExclamationCircleOutlined
} from '@ant-design/icons';
import request from '../utils/request';
import SparkMD5 from 'spark-md5';
import { useNavigate, useSearchParams } from 'react-router-dom';
import mammoth from 'mammoth';
import dayjs from 'dayjs';

const { Header, Content, Sider } = Layout;
const { Text } = Typography;
const { useBreakpoint } = Grid;

// --- Interfaces ---
interface FileMeta {
  id: number;
  file_name: string;
  is_folder: boolean;
  file_size: number;
  parent_id: number;
  file_hash?: string;
  updated_at?: string;
}

interface UserInfo {
    id: number;
    username: string;
    email: string;
    quota_total: number;
    quota_used: number;
    is_admin: boolean;
}

interface UploadTask {
    uid: string;
    fileName: string;
    fileSize: number;
    percent: number;
    status: 'active' | 'exception' | 'success' | 'normal';
    message: string;
    isPaused: boolean;
    file: File;
    errorDetail?: any;
    replacedFileId?: number; // 核心逻辑：记录被软删除的旧文件ID，用于失败还原或成功后彻底删除
}

interface DownloadState {
    visible: boolean;
    fileName: string;
    percent: number;
    status: 'active' | 'exception' | 'success' | 'normal';
    message: string;
}

interface Clipboard {
    items: FileMeta[];
    action: 'copy' | 'cut';
}

interface ConflictResolverState {
    visible: boolean;
    fileName: string;
    fileId: number | null;
    resolve: (action: 'rename' | 'replace' | 'skip', applyToAll: boolean) => void;
}

// --- Helpers ---
const formatSize = (size: number) => {
    if (size === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(size) / Math.log(k));
    return parseFloat((size / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const getFileIcon = (fileName: string, isFolder: boolean) => {
    if (isFolder) return <FolderOutlined style={{ fontSize: 24, color: '#1890ff' }} />;
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext || '')) return <FileImageOutlined style={{ fontSize: 24, color: '#52c41a' }} />;
    if (['pdf'].includes(ext || '')) return <FilePdfOutlined style={{ fontSize: 24, color: '#f5222d' }} />;
    if (['doc', 'docx'].includes(ext || '')) return <FileWordOutlined style={{ fontSize: 24, color: '#1890ff' }} />;
    if (['xls', 'xlsx'].includes(ext || '')) return <FileExcelOutlined style={{ fontSize: 24, color: '#52c41a' }} />;
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext || '')) return <FileZipOutlined style={{ fontSize: 24, color: '#faad14' }} />;
    if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext || '')) return <VideoCameraOutlined style={{ fontSize: 24, color: '#722ed1' }} />;
    if (['txt', 'md', 'py', 'js', 'json', 'html', 'css'].includes(ext || '')) return <FileTextOutlined style={{ fontSize: 24, color: '#8c8c8c' }} />;
    return <FileOutlined style={{ fontSize: 24, color: '#8c8c8c' }} />;
}

// --- Upload Queue ---
class UploadQueue {
    private queue: (() => Promise<void>)[] = [];
    private activeCount = 0;
    private concurrency = 3;

    add(task: () => Promise<void>) {
        this.queue.push(task);
        this.next();
    }

    private next() {
        if (this.activeCount >= this.concurrency || this.queue.length === 0) {
            return;
        }
        const task = this.queue.shift();
        if (task) {
            this.activeCount++;
            task().finally(() => {
                this.activeCount--;
                this.next();
            });
        }
    }

    clear() {
        this.queue = [];
    }

    get isIdle() {
        return this.activeCount === 0 && this.queue.length === 0;
    }
}
const uploadQueue = new UploadQueue();

const Dashboard: React.FC = () => {
  const screens = useBreakpoint();
  const isMobile = screens.md === false || (screens.md === undefined && window.innerWidth < 768);

  const [files, setFiles] = useState<FileMeta[]>([]);
  const [currentPath, setCurrentPath] = useState<{id: number, name: string}[]>([{id: 0, name: '根目录'}]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [viewMode, setViewMode] = useState<'files' | 'trash' | 'admin'>('files');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectedRows, setSelectedRows] = useState<FileMeta[]>([]);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);

  // Search State
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Clipboard State
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);

  // Admin State
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [editUserModalVisible, setEditUserModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<UserInfo | null>(null);
  const [userForm] = Form.useForm();

  // Settings State
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [usernameForm] = Form.useForm();
  const [emailForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [emailCodeId, setEmailCodeId] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // Preview State
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewType, setPreviewType] = useState<'image' | 'video' | 'pdf' | 'text' | 'docx' | 'excel' | 'other'>('other');
  const [previewContent, setPreviewContent] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const docxContainerRef = useRef<HTMLDivElement>(null);

  // Share State
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareFile, setShareFile] = useState<FileMeta | null>(null);
  const [isPrivateShare, setIsPrivateShare] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [shareAccessCode, setShareAccessCode] = useState('');
  const [shareExpireType, setShareExpireType] = useState<'forever' | 'custom'>('forever');
  const [shareExpireDate, setShareExpireDate] = useState<dayjs.Dayjs | null>(null);
  const [shareDownloadLimitType, setShareDownloadLimitType] = useState<'unlimited' | 'custom'>('unlimited');
  const [shareDownloadLimit, setShareDownloadLimit] = useState<number | null>(null);

  // Upload State (New)
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [uploadListVisible, setUploadListVisible] = useState(false);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [uploadListExpanded, setUploadListExpanded] = useState(false); // Controls detail view for large lists

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const pausedTasksRef = useRef<Set<string>>(new Set());

  // Conflict Handling
  const [conflictModal, setConflictModal] = useState<ConflictResolverState>({
      visible: false,
      fileName: '',
      fileId: null,
      resolve: () => {}
  });
  const conflictStrategyRef = useRef<{ action: 'rename' | 'replace' | 'skip', applyToAll: boolean } | null>(null);

  // Download State
  const [downloadState, setDownloadState] = useState<DownloadState>({
      visible: false,
      fileName: '',
      percent: 0,
      status: 'normal',
      message: ''
  });
  const downloadAbortControllerRef = useRef<AbortController | null>(null);

  // Rename State
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renamingFile, setRenamingFile] = useState<FileMeta | null>(null);
  const [newFileName, setNewFileName] = useState('');

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentFolderId = parseInt(searchParams.get('folder') || '0');

  const menuItems = [
      { key: 'files', icon: <HomeOutlined />, label: '我的文件' },
      { key: 'trash', icon: <RestOutlined />, label: '回收站' },
      ...(userInfo?.is_admin ? [{ key: 'admin', icon: <UserOutlined />, label: '系统管理' }] : [])
  ];

  useEffect(() => {
    fetchUserInfo();
    const handleBeforeInstallPrompt = (e: any) => {
        console.log('beforeinstallprompt fired', e);
        e.preventDefault();
        setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    if (viewMode === 'admin') {
        fetchUsers();
    } else {
        if (!isSearching) {
            fetchFiles(currentFolderId);
        }
    }
  }, [currentFolderId, viewMode, isSearching]);

  useEffect(() => {
      // @ts-ignore
      let timer: NodeJS.Timeout;
      if (countdown > 0) {
          timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      }
      return () => clearTimeout(timer);
  }, [countdown]);

  const fetchUserInfo = async () => {
      try {
          const res: any = await request.get('/users/me');
          setUserInfo(res);
      } catch (error) {
          console.error('Failed to fetch user info');
      }
  }

  const fetchUsers = async () => {
      setLoading(true);
      try {
          const res: any = await request.get('/users/');
          setUsers(res);
      } catch (error) {
          message.error('加载用户列表失败');
      } finally {
          setLoading(false);
      }
  }

  const fetchFiles = async (parentId: number, search?: string) => {
    setLoading(true);
    setSelectedRowKeys([]);
    setSelectedRows([]);
    try {
      if (viewMode === 'trash') {
        const res: any = await request.get('/files/trash', { params: { parent_id: parentId } });
        setFiles(res);
        if (parentId === 0) {
          setCurrentPath([{id: 0, name: '回收站'}]);
        } else {
          const resPath: any = await request.get(`/files/path/${parentId}`);
          const path = [{id: 0, name: '回收站'}, ...resPath.map((p: any) => ({ id: p.id, name: p.file_name }))];
          setCurrentPath(path);
        }
      } else if (viewMode === 'files') {
        const params: any = { parent_id: parentId };
        if (search) {
            params.search = search;
        }
        const resFiles: any = await request.get('/files', { params });
        setFiles(resFiles);

        if (search) {
            setCurrentPath([{id: 0, name: `搜索：${search}`}]);
        } else {
            if (parentId === 0) {
              setCurrentPath([{id: 0, name: '根目录'}]);
            } else {
              const resPath: any = await request.get(`/files/path/${parentId}`);
              const path = [{id: 0, name: '根目录'}, ...resPath.map((p: any) => ({ id: p.id, name: p.file_name }))];
              setCurrentPath(path);
            }
        }
      }
    } catch (error) {
      message.error('加载文件列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
      if (value) {
          setIsSearching(true);
          fetchFiles(0, value);
      } else {
          handleClearSearch();
      }
  }

  const handleClearSearch = () => {
      setIsSearching(false);
      setSearchKeyword('');
      setSearchParams({ folder: '0' });
  }

  const handleMenuClick = (e: any) => {
    setViewMode(e.key);
    setIsSearching(false);
    setSearchKeyword('');
    if (e.key !== 'admin') {
        setSearchParams({ folder: '0' });
    }
    if (isMobile) setDrawerVisible(false);
  };

  const handleFolderClick = (record: FileMeta) => {
    if (record.is_folder) {
      setIsSearching(false);
      setSearchKeyword('');
      setSearchParams({ folder: record.id.toString() });
    }
  };

  const handleBreadcrumbClick = (item: {id: number, name: string}) => {
    if (isSearching) {
        setIsSearching(false);
        setSearchKeyword('');
        setSearchParams({ folder: '0' });
        return;
    }
    setSearchParams({ folder: item.id.toString() });
  };

  const handleGoUp = () => {
      if (isSearching) {
          handleClearSearch();
          return;
      }
      if (currentPath.length > 1) {
          const parent = currentPath[currentPath.length - 2];
          setSearchParams({ folder: parent.id.toString() });
      }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName) return;
    if (/[<>:"/\\|?*]/.test(newFolderName)) {
      message.error('文件夹名称包含非法字符: < > : " / \\ | ? *');
      return;
    }
    try {
      await request.post('/files/folder', {
        file_name: newFolderName,
        parent_id: currentFolderId
      });
      message.success('文件夹创建成功');
      setIsModalOpen(false);
      setNewFolderName('');
      fetchFiles(currentFolderId);
    } catch (error) {
      message.error('创建文件夹失败');
    }
  };

  const handleCancelDownload = () => {
      if (downloadAbortControllerRef.current) {
          downloadAbortControllerRef.current.abort();
      }
      setDownloadState(prev => ({ ...prev, visible: false }));
      message.info('下载已取消');
  };

  const handleDownload = async (record: FileMeta) => {
      downloadAbortControllerRef.current = new AbortController();
      if (record.is_folder) {
          try {
              setDownloadState({
                  visible: true,
                  fileName: `${record.file_name}.zip`,
                  percent: 0,
                  status: 'active',
                  message: '正在打包下载...'
              });

              const response = await request.post('/files/download/batch', [record.id], {
                  responseType: 'blob',
                  timeout: 0,
                  signal: downloadAbortControllerRef.current.signal,
                  onDownloadProgress: (progressEvent) => {
                      const { loaded, total } = progressEvent;
                      if (total) {
                          const percent = Math.round((loaded / total) * 100);
                          setDownloadState(prev => ({ ...prev, percent, message: `正在下载... ${percent}%` }));
                      } else {
                          setDownloadState(prev => ({ ...prev, message: `正在下载... ${formatSize(loaded)}` }));
                      }
                  }
              });

              const url = window.URL.createObjectURL(new Blob([response as any]));
              const link = document.createElement('a');
              link.href = url;
              link.setAttribute('download', `${record.file_name}.zip`);
              document.body.appendChild(link);
              link.click();
              link.remove();

              setDownloadState(prev => ({ ...prev, percent: 100, status: 'success', message: '下载完成' }));
              setTimeout(() => setDownloadState(prev => ({ ...prev, visible: false })), 2000);
          } catch (error: any) {
              if (error.name === 'Canceled' || error.message === 'canceled') {
                  return;
              }
              setDownloadState(prev => ({ ...prev, status: 'exception', message: '下载失败' }));
              setTimeout(() => setDownloadState(prev => ({ ...prev, visible: false })), 2000);
          }
          return;
      }
      try {
          setDownloadState({
              visible: true,
              fileName: record.file_name,
              percent: 0,
              status: 'active',
              message: '开始下载...'
          });

          const response = await request.get(`/files/download/${record.id}`, {
              responseType: 'blob',
              timeout: 0,
              signal: downloadAbortControllerRef.current.signal,
              onDownloadProgress: (progressEvent) => {
                  const { loaded, total } = progressEvent;
                  if (total) {
                      const percent = Math.round((loaded / total) * 100);
                      setDownloadState(prev => ({ ...prev, percent, message: `正在下载... ${percent}%` }));
                  } else {
                      setDownloadState(prev => ({ ...prev, message: `正在下载... ${formatSize(loaded)}` }));
                  }
              }
          });
          const url = window.URL.createObjectURL(new Blob([response as any]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', record.file_name);
          document.body.appendChild(link);
          link.click();
          link.remove();

          setDownloadState(prev => ({ ...prev, percent: 100, status: 'success', message: '下载完成' }));
          setTimeout(() => setDownloadState(prev => ({ ...prev, visible: false })), 2000);
      } catch (error: any) {
          if (error.name === 'Canceled' || error.message === 'canceled') {
              return;
          }
          setDownloadState(prev => ({ ...prev, status: 'exception', message: '下载失败' }));
          setTimeout(() => setDownloadState(prev => ({ ...prev, visible: false })), 2000);
      }
  }

  const handleBatchDownload = async () => {
      if (selectedRowKeys.length === 0) return;
      downloadAbortControllerRef.current = new AbortController();
      const fileName = `batch_download_${new Date().getTime()}.zip`;
      try {
          setDownloadState({
              visible: true,
              fileName: fileName,
              percent: 0,
              status: 'active',
              message: '正在打包下载...'
          });

          const response = await request.post('/files/download/batch', selectedRowKeys, {
              responseType: 'blob',
              timeout: 0,
              signal: downloadAbortControllerRef.current.signal,
              onDownloadProgress: (progressEvent) => {
                  const { loaded, total } = progressEvent;
                  if (total) {
                      const percent = Math.round((loaded / total) * 100);
                      setDownloadState(prev => ({ ...prev, percent, message: `正在下载... ${percent}%` }));
                  } else {
                      setDownloadState(prev => ({ ...prev, message: `正在下载... ${formatSize(loaded)}` }));
                  }
              }
          });
          const url = window.URL.createObjectURL(new Blob([response as any]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', fileName);
          document.body.appendChild(link);
          link.click();
          link.remove();

          setDownloadState(prev => ({ ...prev, percent: 100, status: 'success', message: '下载完成' }));
          setTimeout(() => setDownloadState(prev => ({ ...prev, visible: false })), 2000);

          setSelectedRowKeys([]);
          setSelectedRows([]);
      } catch (error: any) {
          if (error.name === 'Canceled' || error.message === 'canceled') {
              return;
          }
          setDownloadState(prev => ({ ...prev, status: 'exception', message: '批量下载失败' }));
          setTimeout(() => setDownloadState(prev => ({ ...prev, visible: false })), 2000);
      }
  }

  const handleDelete = async (record: FileMeta) => {
      try {
          message.loading({ content: '正在删除...', key: 'delete' });
          await request.delete(`/files/${record.id}`);
          await fetchFiles(currentFolderId);
          fetchUserInfo();
          message.success({ content: '已移入回收站', key: 'delete' });
      } catch (error) {
          message.error({ content: '删除失败', key: 'delete' });
      }
  }

  const handleBatchDelete = async () => {
      if (selectedRowKeys.length === 0) return;
      try {
          message.loading({ content: '正在批量删除...', key: 'batchDelete' });
          await request.post('/files/batch/delete', selectedRowKeys);
          await fetchFiles(currentFolderId);
          fetchUserInfo();
          setSelectedRowKeys([]);
          setSelectedRows([]);
          message.success({ content: '批量删除成功', key: 'batchDelete' });
      } catch (error) {
          message.error({ content: '批量删除失败', key: 'batchDelete' });
      }
  }

  const handleCopy = () => {
      if (selectedRows.length === 0) return;
      setClipboard({ items: selectedRows, action: 'copy' });
      message.info(`已复制 ${selectedRows.length} 个项目`);
      setSelectedRowKeys([]);
      setSelectedRows([]);
  }

  const handleCut = () => {
      if (selectedRows.length === 0) return;
      setClipboard({ items: selectedRows, action: 'cut' });
      message.info(`已剪切 ${selectedRows.length} 个项目`);
      setSelectedRowKeys([]);
      setSelectedRows([]);
  }

  const handlePaste = async () => {
      if (!clipboard) return;
      try {
          message.loading({ content: '正在处理...', key: 'paste' });
          const fileIds = clipboard.items.map(item => item.id);
          if (clipboard.action === 'copy') {
              await request.post('/files/batch/copy', {
                  file_ids: fileIds,
                  target_parent_id: currentFolderId
              });
              await fetchFiles(currentFolderId);
              fetchUserInfo();
              message.success({ content: '粘贴成功', key: 'paste' });
          } else {
              await request.post('/files/batch/move', {
                  file_ids: fileIds,
                  target_parent_id: currentFolderId
              });
              await fetchFiles(currentFolderId);
              fetchUserInfo();
              message.success({ content: '移动成功', key: 'paste' });
              setClipboard(null);
          }
      } catch (error) {
          message.error({ content: '粘贴失败', key: 'paste' });
      }
  }

  const handleRestore = async (record: FileMeta) => {
      try {
          message.loading({ content: '正在还原...', key: 'restore' });
          await request.post(`/files/trash/${record.id}/restore`);
          await fetchFiles(currentFolderId);
          message.success({ content: '还原成功', key: 'restore' });
      } catch (error) {
          message.error({ content: '还原失败', key: 'restore' });
      }
  }

  const handleBatchRestore = async () => {
      if (selectedRowKeys.length === 0) return;
      try {
          message.loading({ content: '正在批量还原...', key: 'batchRestore' });
          await request.post('/files/batch/restore', selectedRowKeys);
          await fetchFiles(currentFolderId);
          setSelectedRowKeys([]);
          setSelectedRows([]);
          message.success({ content: '批量还原成功', key: 'batchRestore' });
      } catch (error) {
          message.error({ content: '批量还原失败', key: 'batchRestore' });
      }
  }

  const handlePermanentDelete = async (record: FileMeta) => {
      try {
          message.loading({ content: '正在彻底删除...', key: 'permanentDelete' });
          await request.delete(`/files/trash/${record.id}`);
          await fetchFiles(currentFolderId);
          fetchUserInfo();
          message.success({ content: '彻底删除成功', key: 'permanentDelete' });
      } catch (error) {
          message.error({ content: '删除失败', key: 'permanentDelete' });
      }
  }

  const handleBatchPermanentDelete = async () => {
      if (selectedRowKeys.length === 0) return;
      try {
          message.loading({ content: '正在彻底删除...', key: 'batchPermanentDelete' });
          await request.post('/files/batch/trash/delete', selectedRowKeys);
          await fetchFiles(currentFolderId);
          fetchUserInfo();
          setSelectedRowKeys([]);
          setSelectedRows([]);
          message.success({ content: '批量彻底删除成功', key: 'batchPermanentDelete' });
      } catch (error) {
          message.error({ content: '批量彻底删除失败', key: 'batchPermanentDelete' });
      }
  }

  const handleRename = (record: FileMeta) => {
      setRenamingFile(record);
      setNewFileName(record.file_name);
      setRenameModalVisible(true);
  };

  const handleConfirmRename = async () => {
      if (!renamingFile || !newFileName) return;
      if (/[<>:"/\\|?*]/.test(newFileName)) {
        message.error('文件名包含非法字符: < > : " / \\ | ? *');
        return;
      }
      try {
          await request.put(`/files/${renamingFile.id}`, { file_name: newFileName });
          message.success('重命名成功');
          setRenameModalVisible(false);
          fetchFiles(currentFolderId);
      } catch (error: any) {
          if (error.response?.status === 409) {
              message.error('该文件夹下已存在同名文件');
          } else {
              message.error('重命名失败');
          }
      }
  };

  const handlePreview = async (record: FileMeta) => {
      const token = localStorage.getItem('token');
      const url = `/api/v1/files/preview/${record.id}?token=${token}`;
      const excelUrl = `/api/v1/files/preview/excel/${record.id}?token=${token}`;

      setPreviewFile(record);
      setPreviewUrl(url);
      setPreviewContent(null);
      setPreviewLoading(true);

      const ext = record.file_name.split('.').pop()?.toLowerCase();
      const textExts = ['txt', 'md', 'py', 'js', 'json', 'html', 'css', 'xml', 'log', 'ini', 'yml', 'yaml', 'c', 'cpp', 'java'];

      try {
          if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext || '')) {
              setPreviewType('image');
          } else if (['mp4', 'webm', 'ogg', 'mov'].includes(ext || '')) {
              setPreviewType('video');
          } else if (['pdf'].includes(ext || '')) {
              setPreviewType('pdf');
          } else if (textExts.includes(ext || '')) {
              setPreviewType('text');
              const res = await fetch(url);
              if (!res.ok) throw new Error('Network response was not ok');
              const text = await res.text();
              setPreviewContent(text);
          } else if (ext === 'docx') {
              setPreviewType('docx');
              const res = await fetch(url);
              if (!res.ok) throw new Error('Network response was not ok');
              const blob = await res.blob();
              const arrayBuffer = await blob.arrayBuffer();

              const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
              setPreviewContent(result.value);
          } else if (['xlsx', 'xls'].includes(ext || '')) {
              setPreviewType('excel');
              const res = await fetch(excelUrl);
              if (!res.ok) throw new Error('Network response was not ok');
              const html = await res.text();
              setPreviewContent(html);
          } else {
              setPreviewType('other');
          }
      } catch (e) {
          console.error("Preview Error:", e);
          message.error('加载文件失败');
          setPreviewType('other');
      } finally {
          setPreviewLoading(false);
      }

      setPreviewVisible(true);
  }

  useEffect(() => {
      if (previewVisible && previewType === 'docx' && previewContent && docxContainerRef.current) {
          docxContainerRef.current.innerHTML = previewContent;
      }
  }, [previewVisible, previewType, previewContent]);

  const handleShare = (record: FileMeta) => {
      setShareFile(record);
      setIsPrivateShare(false);
      setShareLink('');
      setShareAccessCode('');
      setShareExpireType('forever');
      setShareExpireDate(null);
      setShareDownloadLimitType('unlimited');
      setShareDownloadLimit(null);
      setShareModalVisible(true);
  }

  const createShareLink = async () => {
      if (!shareFile) return;
      try {
          const payload: any = {
              file_id: shareFile.id,
              is_private: isPrivateShare,
              expire_at: shareExpireType === 'custom' && shareExpireDate ? shareExpireDate.toISOString() : null,
              max_downloads: shareDownloadLimitType === 'custom' && shareDownloadLimit ? shareDownloadLimit : -1
          };

          const res: any = await request.post('/shares/', payload);

          const link = `${window.location.origin}/share/${res.share_key}`;
          setShareLink(link);
          if (res.access_code) {
              setShareAccessCode(res.access_code);
          }
          message.success('分享链接创建成功');
      } catch (error) {
          message.error('创建分享失败');
      }
  }

  const handleEditUser = (user: UserInfo) => {
      setEditingUser(user);
      userForm.setFieldsValue({
          quota_total_gb: user.quota_total / 1024 / 1024 / 1024,
          is_admin: user.is_admin
      });
      setEditUserModalVisible(true);
  }

  const handleUpdateUser = async () => {
      try {
          const values = await userForm.validateFields();
          await request.put(`/users/${editingUser?.id}`, {
              quota_total: values.quota_total_gb * 1024 * 1024 * 1024,
              is_admin: values.is_admin
          });
          message.success('用户更新成功');
          setEditUserModalVisible(false);
          fetchUsers();
      } catch (error) {
          message.error('更新失败');
      }
  }

  const handleOpenSettings = () => {
      if (userInfo) {
          usernameForm.setFieldsValue({
              username: userInfo.username
          });
          emailForm.setFieldsValue({
              email: userInfo.email
          });
      }
      setSettingsModalVisible(true);
  };

  const handleUpdateUsername = async () => {
      try {
          const values = await usernameForm.validateFields();
          await request.put('/users/me/username', values);
          message.success('用户名更新成功');
          fetchUserInfo();
      } catch (error: any) {
          if (error.response?.data?.detail) {
              message.error(error.response.data.detail);
          } else {
              message.error('更新失败');
          }
      }
  };

  const handleSendEmailCode = async () => {
      try {
          const email = emailForm.getFieldValue('email');
          if (!email) {
              message.error('请先输入新邮箱');
              return;
          }
          if (!/^[a-zA-Z0-9_\u4e00-\u9fa5-.]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/.test(email)) {
              message.error('邮箱格式不正确');
              return;
          }

          const res: any = await request.post('/login/send-update-email-code', { email });
          if (res.code === 200) {
              setEmailCodeId(res.data.id);
              setCountdown(60);
              message.success('验证码已发送');
          } else {
              message.error(res.message || '发送失败');
          }
      } catch (error) {
          message.error('发送验证码失败');
      }
  };

  const handleUpdateEmail = async () => {
      try {
          const values = await emailForm.validateFields();
          if (!emailCodeId) {
              message.error('请先获取验证码');
              return;
          }
          await request.put('/users/me/email', {
              email: values.email,
              email_code: values.email_code,
              email_id: emailCodeId
          });
          message.success('邮箱更新成功');
          fetchUserInfo();
          setEmailCodeId('');
          emailForm.setFieldsValue({ email_code: '' });
      } catch (error: any) {
          if (error.response?.data?.detail) {
              message.error(error.response.data.detail);
          } else {
              message.error('更新失败');
          }
      }
  };

  const handleUpdatePassword = async () => {
      try {
          const values = await passwordForm.validateFields();
          if (values.new_password !== values.confirm_password) {
              message.error('两次输入的密码不一致');
              return;
          }
          await request.put('/users/me/password', {
              current_password: values.current_password,
              new_password: values.new_password
          });
          message.success('密码修改成功');
          passwordForm.resetFields();
      } catch (error: any) {
          if (error.response?.data?.detail) {
              message.error(error.response.data.detail);
          } else {
              message.error('修改失败');
          }
      }
  };

  const handleAddToDesktop = async () => {
      if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') {
              setDeferredPrompt(null);
          }
      } else {
          Modal.info({
              title: '添加到桌面快捷方式',
              content: (
                  <div>
                      <p>您的浏览器不支持自动安装，请尝试手动操作：</p>
                      <ol>
                          <li>在浏览器右上角点击菜单按钮 (通常是三个点)。</li>
                          <li>选择 <strong>更多工具</strong> 或 <strong>应用</strong>。</li>
                          <li>点击 <strong>创建快捷方式</strong> 或 <strong>安装应用</strong>。</li>
                          <li>勾选 <strong>在窗口中打开</strong> (可选)。</li>
                          <li>点击 <strong>创建</strong>。</li>
                      </ol>
                  </div>
              ),
          });
      }
  };

  // --- Upload Logic (Refactored for Conflict Handling & Optimization) ---
  const CHUNK_SIZE = 20 * 1024 * 1024;

  const updateTask = (uid: string, updates: Partial<UploadTask>) => {
      setUploadTasks(prev => prev.map(t => t.uid === uid ? { ...t, ...updates } : t));
  };

  const resolveConflict = (fileName: string, fileId: number): Promise<{ action: 'rename' | 'replace' | 'skip', applyToAll: boolean }> => {
      return new Promise((resolve) => {
          if (conflictStrategyRef.current) {
              resolve(conflictStrategyRef.current);
          } else {
              setConflictModal({
                  visible: true,
                  fileName,
                  fileId,
                  resolve: (action, applyToAll) => {
                      if (applyToAll) {
                          conflictStrategyRef.current = { action, applyToAll };
                      }
                      setConflictModal(prev => ({ ...prev, visible: false }));
                      resolve({ action, applyToAll });
                  }
              });
          }
      });
  };

  const calculateHash = (file: File, uid: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const chunkSize = 10 * 1024 * 1024;
      const chunks = Math.ceil(file.size / chunkSize);
      let currentChunk = 0;
      const spark = new SparkMD5.ArrayBuffer();
      const fileReader = new FileReader();

      fileReader.onload = (e) => {
        if (e.target?.result) {
          if (pausedTasksRef.current.has(uid)) return reject(new Error("stopped"));
          if (!abortControllersRef.current.has(uid)) return reject(new Error("stopped"));

          const progress = Math.round(((currentChunk + 1) / chunks) * 100);
          updateTask(uid, { message: `正在计算 Hash... ${progress}%` });

          spark.append(e.target.result as ArrayBuffer);
          currentChunk++;

          if (currentChunk < chunks) {
            loadNext();
          } else {
            resolve(spark.end());
          }
        }
      };

      fileReader.onerror = () => {
        reject("读取文件失败");
      };

      function loadNext() {
        const start = currentChunk * chunkSize;
        const end = ((start + chunkSize) >= file.size) ? file.size : start + chunkSize;
        fileReader.readAsArrayBuffer(file.slice(start, end));
      }

      loadNext();
    });
  };

  const processUpload = async (file: File) => {
    const uid = (file as any).uid;
    const MAX_RETRIES = 3;
    let lastError: any = null;
    let successMessage = '上传成功';
    let autoRename = false;
    let localReplacedFileId: number | undefined = undefined;

    if (!abortControllersRef.current.has(uid)) {
        abortControllersRef.current.set(uid, new AbortController());
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (pausedTasksRef.current.has(uid)) return;
        if (!abortControllersRef.current.has(uid)) return;

        try {
            let controller = abortControllersRef.current.get(uid);
            if (!controller || controller.signal.aborted) {
                controller = new AbortController();
                abortControllersRef.current.set(uid, controller);
            }

            const relativePath = (file as any).webkitRelativePath || '';

            if (attempt === 1) {
                updateTask(uid, { status: 'active', message: '计算文件 Hash...', isPaused: false });
            }

            const fileHash = await calculateHash(file, uid);
            if (pausedTasksRef.current.has(uid) || !abortControllersRef.current.has(uid)) throw new Error("stopped");

            updateTask(uid, { message: '检查秒传...' });

            // Check Fast Upload with Auto Rename support
            let checkRes: any;
            try {
                const checkFormData = new FormData();
                checkFormData.append('file_hash', fileHash);
                checkFormData.append('file_name', file.name);
                checkFormData.append('parent_id', currentFolderId.toString());
                if (relativePath) checkFormData.append('relative_path', relativePath);
                if (autoRename) checkFormData.append('auto_rename', 'true');

                checkRes = await request.post('/files/check_fast_upload', checkFormData);
            } catch (err: any) {
                // Handle Conflict (409) for Fast Upload
                if (err.response && err.response.status === 409) {
                    const errorDetail = err.response.data.detail;
                    const existingFileId = typeof errorDetail === 'object' ? errorDetail.file_id : null;

                    updateTask(uid, { message: '文件名冲突，等待处理...', isPaused: true });
                    const { action } = await resolveConflict(file.name, existingFileId);

                    updateTask(uid, { isPaused: false });

                    if (action === 'skip') {
                        updateTask(uid, { status: 'success', percent: 100, message: '已跳过' });
                        return;
                    } else if (action === 'rename') {
                        autoRename = true;
                        attempt--; // Retry same attempt count
                        continue;
                    } else if (action === 'replace') {
                        if (existingFileId) {
                            updateTask(uid, { message: '正在移入回收站...' });
                            // Soft delete old file first
                            await request.delete(`/files/${existingFileId}`);
                            localReplacedFileId = existingFileId;
                            updateTask(uid, { replacedFileId: existingFileId });
                            attempt--;
                            continue;
                        } else {
                            throw new Error("无法获取冲突文件ID");
                        }
                    }
                }
                throw err;
            }

            if (pausedTasksRef.current.has(uid) || !abortControllersRef.current.has(uid)) throw new Error("stopped");

            if (checkRes.can_fast_upload) {
                lastError = null;
                successMessage = '极速秒传成功';
                break; // Success
            }

            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
            updateTask(uid, { message: `准备上传 ${totalChunks} 分片...` });

            // Init Upload with Auto Rename support
            let initRes: any;
            try {
                const initData = {
                    file_hash: fileHash,
                    file_size: file.size,
                    file_name: file.name,
                    parent_id: currentFolderId,
                    total_chunks: totalChunks,
                    relative_path: relativePath
                };

                // Using params for auto_rename as it's a simple flag
                const res = await request.post('/files/upload/init', initData, {
                    params: { auto_rename: autoRename }
                });
                initRes = res;
            } catch (err: any) {
                // Handle 409 in Init (Same logic)
                 if (err.response && err.response.status === 409) {
                     const errorDetail = err.response.data.detail;
                     const existingFileId = typeof errorDetail === 'object' ? errorDetail.file_id : null;
                     updateTask(uid, { message: '文件名冲突，等待处理...', isPaused: true });
                     const { action } = await resolveConflict(file.name, existingFileId);
                     updateTask(uid, { isPaused: false });
                     if (action === 'skip') {
                         updateTask(uid, { status: 'exception', message: '已跳过' });
                         return;
                     } else if (action === 'rename') {
                         autoRename = true;
                         attempt--;
                         continue;
                     } else if (action === 'replace') {
                         if(existingFileId) {
                            await request.delete(`/files/${existingFileId}`); // Soft delete
                            localReplacedFileId = existingFileId;
                            updateTask(uid, { replacedFileId: existingFileId });
                            attempt--;
                            continue;
                         }
                     }
                 }
                 throw err;
            }

            if (pausedTasksRef.current.has(uid) || !abortControllersRef.current.has(uid)) throw new Error("stopped");

            const { upload_id, uploaded_chunks } = initRes;
            const uploadedSet = new Set(uploaded_chunks);

            for (let i = 0; i < totalChunks; i++) {
                if (pausedTasksRef.current.has(uid) || !abortControllersRef.current.has(uid)) throw new Error("stopped");

                const chunkPercent = Math.round(((i) / totalChunks) * 100);
                updateTask(uid, {
                    percent: chunkPercent,
                    message: `上传分片 (${i + 1}/${totalChunks})`
                });

                if (uploadedSet.has(i)) continue;

                const start = i * CHUNK_SIZE;
                const end = Math.min(file.size, start + CHUNK_SIZE);
                const chunk = file.slice(start, end);
                const formData = new FormData();
                formData.append('upload_id', upload_id);
                formData.append('chunk_index', i.toString());
                formData.append('file', chunk);

                await request.post('/files/upload/chunk', formData, {
                    signal: controller.signal
                });
            }

            updateTask(uid, { message: '合并文件...' });

            // Merge with Auto Rename support
            try {
                const mergeFormData = new FormData();
                mergeFormData.append('upload_id', upload_id);
                mergeFormData.append('file_name', file.name);
                mergeFormData.append('file_hash', fileHash);
                mergeFormData.append('parent_id', currentFolderId.toString());
                if (relativePath) mergeFormData.append('relative_path', relativePath);
                if (autoRename) mergeFormData.append('auto_rename', 'true');

                await request.post('/files/upload/merge', mergeFormData);
            } catch (err: any) {
                 if (err.response && err.response.status === 409) {
                     const errorDetail = err.response.data.detail;
                     const existingFileId = typeof errorDetail === 'object' ? errorDetail.file_id : null;
                     updateTask(uid, { message: '文件名冲突，等待处理...', isPaused: true });
                     const { action } = await resolveConflict(file.name, existingFileId);
                     updateTask(uid, { isPaused: false });
                     if (action === 'skip') {
                         updateTask(uid, { status: 'success', percent: 100 , message: '已跳过' });
                         abortControllersRef.current.delete(uid);
                         return;
                     } else if (action === 'rename') {
                         autoRename = true;
                         attempt--;
                         continue;
                     } else if (action === 'replace') {
                         if (existingFileId) {
                             await request.delete(`/files/${existingFileId}`); // Soft delete
                             localReplacedFileId = existingFileId;
                             updateTask(uid, { replacedFileId: existingFileId });
                             attempt--;
                             continue;
                         }
                     }
                 }
                 throw err;
            }

            lastError = null; // Success
            break; // Exit retry loop
        } catch (err: any) {
            lastError = err;
            if (err.name === 'CanceledError' || err.message === 'stopped') {
                return; // Exit function completely - Cleanup handled in handleCancelUpload or Pause
            }
            if (attempt < MAX_RETRIES) {
                const delay = Math.pow(2, attempt) * 1000;
                updateTask(uid, { message: `失败, ${delay / 1000}s 后重试...` });
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                 // Retry exhausted, failure. Restore old file if needed.
                 if (localReplacedFileId) {
                     try {
                         await request.post(`/files/trash/${localReplacedFileId}/restore`);
                         message.warning(`上传失败，已还原文件: ${file.name}`);
                     } catch(e) {
                         message.error(`上传失败且还原失败: ${file.name}`);
                     }
                 }
            }
        }
    }

    // Check if cancelled during retry wait
    if (!abortControllersRef.current.has(uid)) return;

    if (lastError) {
        updateTask(uid, { status: 'exception', message: lastError.response?.data?.detail?.message || '上传失败' });
    } else {
        // Upload Success, now permanently delete the replaced file
        if (localReplacedFileId) {
            try {
                await request.delete(`/files/trash/${localReplacedFileId}`);
            } catch (e) {
                console.warn("清理旧文件失败", e);
            }
        }
        updateTask(uid, { status: 'success', percent: 100, message: successMessage });
        fetchFiles(currentFolderId);
        fetchUserInfo();
        abortControllersRef.current.delete(uid);
    }
  };

  const customRequest = async (options: any) => {
      const file = options.file;
      const uid = file.uid;

      const newTask: UploadTask = {
          uid,
          fileName: file.name,
          fileSize: file.size,
          percent: 0,
          status: 'active',
          message: '等待上传...',
          isPaused: false,
          file
      };

      setUploadTasks(prev => {
          if (prev.some(t => t.uid === uid)) return prev;
          return [...prev, newTask];
      });
      setUploadListVisible(true);

      uploadQueue.add(() => processUpload(file));
  };

  const handlePauseUpload = (uid: string) => {
      pausedTasksRef.current.add(uid);
      const controller = abortControllersRef.current.get(uid);
      if (controller) controller.abort();
      updateTask(uid, { isPaused: true, status: 'normal', message: '已暂停' });
  };

  const handleResumeUpload = (uid: string) => {
      pausedTasksRef.current.delete(uid);
      const task = uploadTasks.find(t => t.uid === uid);
      if (task) {
          updateTask(uid, { isPaused: false, status: 'active', message: '准备继续...' });
          uploadQueue.add(() => processUpload(task.file));
      }
  };

  const handleCancelUpload = async (uid: string) => {
      // Check if this task replaced a file and restore it
      const task = uploadTasks.find(t => t.uid === uid);
      if (task?.replacedFileId) {
          try {
              await request.post(`/files/trash/${task.replacedFileId}/restore`);
              message.info(`已还原文件: ${task.fileName}`);
          } catch (e) {
              console.error('还原失败', e);
          }
      }

      pausedTasksRef.current.delete(uid);
      const controller = abortControllersRef.current.get(uid);
      if (controller) controller.abort();
      abortControllersRef.current.delete(uid);

      setUploadTasks(prev => prev.filter(t => t.uid !== uid));
      if (uploadTasks.length <= 1) {
          setUploadListVisible(false);
      }
  };

  const handleRetryUpload = (uid: string) => {
      const task = uploadTasks.find(t => t.uid === uid);
      if (task) {
          updateTask(uid, { status: 'active', message: '重试中...', percent: 0 });
          uploadQueue.add(() => processUpload(task.file));
      }
  };

  const handleClearCompleted = () => {
      setUploadTasks(prev => prev.filter(t => t.status !== 'success'));
      if (uploadTasks.filter(t => t.status !== 'success').length === 0) {
          setUploadListVisible(false);
      }

      // 刷新当前界面
      window.location.reload();
  };

  const handleClearAll = async () => {
      // Restore replaced files for active/failed tasks
      const tasksToRestore = uploadTasks.filter(t => t.replacedFileId && t.status !== 'success');
      for (const task of tasksToRestore) {
           try {
              await request.post(`/files/trash/${task.replacedFileId}/restore`);
           } catch (e) { console.error(e); }
      }

      // 1. Clear waiting queue
      uploadQueue.clear();

      // 2. Abort running requests
      abortControllersRef.current.forEach((controller) => {
          controller.abort();
      });
      abortControllersRef.current.clear();
      pausedTasksRef.current.clear();

      // 3. Clear task list and close
      setUploadTasks([]);
      setUploadListVisible(false);

      window.location.reload();
  };

  const handleLogout = () => {
      localStorage.removeItem('token');
      navigate('/login');
  }

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[], newSelectedRows: FileMeta[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
      setSelectedRows(newSelectedRows);
    },
  };

  const handleMobileSelect = (record: FileMeta) => {
      const newSelectedRowKeys = [...selectedRowKeys];
      const newSelectedRows = [...selectedRows];
      const index = newSelectedRowKeys.indexOf(record.id);
      if (index >= 0) {
          newSelectedRowKeys.splice(index, 1);
          newSelectedRows.splice(index, 1);
      } else {
          newSelectedRowKeys.push(record.id);
          newSelectedRows.push(record);
      }
      setSelectedRowKeys(newSelectedRowKeys);
      setSelectedRows(newSelectedRows);
  }

  const handleSelectAll = (e: any) => {
      if (e.target.checked) {
          const allKeys = files.map(f => f.id);
          setSelectedRowKeys(allKeys);
          setSelectedRows(files);
      } else {
          setSelectedRowKeys([]);
          setSelectedRows([]);
      }
  };

  const renderFileActions = (record: FileMeta) => {
      if (viewMode === 'trash') {
          return (
              <Space>
                  <Tooltip title="还原"><Button type="text" icon={<UndoOutlined />} onClick={(e) => { e.stopPropagation(); handleRestore(record); }} /></Tooltip>
                  <Popconfirm title="彻底删除" description="确定吗？" onConfirm={(e) => { e?.stopPropagation(); handlePermanentDelete(record); }} onCancel={(e) => e?.stopPropagation()}>
                      <Tooltip title="彻底删除"><Button type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} /></Tooltip>
                  </Popconfirm>
              </Space>
          );
      }
      return (
          <Space>
              <Tooltip title="重命名"><Button type="text" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); handleRename(record); }} /></Tooltip>
              {!record.is_folder && (
                  <>
                      <Tooltip title="预览"><Button type="text" icon={<EyeOutlined />} onClick={(e) => { e.stopPropagation(); handlePreview(record); }} /></Tooltip>
                  </>
              )}
              <Tooltip title="分享"><Button type="text" icon={<ShareAltOutlined />} onClick={(e) => { e.stopPropagation(); handleShare(record); }} /></Tooltip>
              <Tooltip title="下载"><Button type="text" icon={<DownloadOutlined />} onClick={(e) => { e.stopPropagation(); handleDownload(record); }} /></Tooltip>
              <Popconfirm title="删除文件" description="确定移入回收站？" onConfirm={(e) => { e?.stopPropagation(); handleDelete(record); }} onCancel={(e) => e?.stopPropagation()}>
                  <Tooltip title="删除"><Button type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} /></Tooltip>
              </Popconfirm>
          </Space>
      );
  };

  const columns = [
    {
      title: '文件名',
      dataIndex: 'file_name',
      key: 'file_name',
      render: (text: string, record: FileMeta) => (
        <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => handleFolderClick(record)}>
          {getFileIcon(text, record.is_folder)}
          <span style={{ marginLeft: 8 }}>{text}</span>
        </div>
      ),
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 120,
      render: (size: number, record: FileMeta) => record.is_folder ? '-' : formatSize(size),
      responsive: ['md'] as any,
    },
    {
        title: '修改时间',
        dataIndex: 'updated_at',
        key: 'updated_at',
        width: 180,
        render: (text: string) => text ? new Date(text.endsWith('Z') ? text : text + 'Z').toLocaleString() : '-',
        responsive: ['lg'] as any,
    },
    {
        title: '操作',
        key: 'action',
        width: 220,
        render: (_: any, record: FileMeta) => renderFileActions(record)
    }
  ];

  const userColumns = [
      { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
      { title: '用户名', dataIndex: 'username', key: 'username' },
      { title: '已用空间', dataIndex: 'quota_used', key: 'quota_used', render: (val: number) => formatSize(val), responsive: ['md'] as any },
      { title: '总配额', dataIndex: 'quota_total', key: 'quota_total', render: (val: number) => formatSize(val), responsive: ['md'] as any },
      { title: '角色', dataIndex: 'is_admin', key: 'is_admin', render: (val: boolean) => val ? '管理员' : '普通用户' },
      { title: '操作', key: 'action', render: (_: any, record: UserInfo) => <Button type="link" icon={<SettingOutlined />} onClick={() => handleEditUser(record)}>编辑</Button> }
  ];

  // --- Optimized Upload List Renderer ---
  const renderUploadList = () => {
      const successCount = uploadTasks.filter(t => t.status === 'success').length;
      const failCount = uploadTasks.filter(t => t.status === 'exception').length;
      const activeCount = uploadTasks.length - successCount - failCount;
      const totalCount = uploadTasks.length;
      const isLargeList = totalCount > 100;
      const showSimpleMode = isLargeList && !uploadListExpanded;
      const isAllSuccess = totalCount > 0 && successCount === totalCount;

      // Limit rendering for performance
      const renderedTasks = showSimpleMode
          ? uploadTasks.filter(t => t.status !== 'success').slice(0, 50)
          : uploadTasks.slice(0, 100);

      return (
          <Card
            style={{ position: 'fixed', bottom: 24, right: 24, width: showSimpleMode ? 320 : 330, zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxHeight: '50vh', display: 'flex', flexDirection: 'column' }}
            bodyStyle={{ padding: 0, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <CloudUploadOutlined style={{ marginRight: 8 }} />
                        <span style={{ fontSize: 14 }}>
                            {showSimpleMode ? `正在上传 ${activeCount} 个文件` : `上传列表 (${successCount}/${totalCount})`}
                        </span>
                    </div>
                    <Space>
                        {isLargeList && (
                             <Button type="link" size="small" onClick={() => setUploadListExpanded(!uploadListExpanded)}>
                                 {uploadListExpanded ? '精简' : '详细'}
                             </Button>
                        )}
                        <Tooltip title="清除已完成"><Button type="text" icon={<ClearOutlined />} onClick={handleClearCompleted} /></Tooltip>

                        {/* Modified Close Button: Clears All without Confirmation if all success */}
                        {isAllSuccess ? (
                             <Tooltip title="关闭"><Button type="text" icon={<CloseCircleOutlined />} onClick={handleClearAll} /></Tooltip>
                        ) : (
                            <Popconfirm
                                title="确定要清空全部上传队列吗？"
                                description="这将会取消所有正在进行的上传任务。"
                                onConfirm={handleClearAll}
                                okText="清空"
                                cancelText="取消"
                                placement="topRight"
                            >
                                <Tooltip><Button type="text" icon={<CloseCircleOutlined />} /></Tooltip>
                            </Popconfirm>
                        )}
                    </Space>
                </div>
            }
            size="small"
          >
              {showSimpleMode && (
                   <div style={{ padding: '12px 16px', background: '#f5f5f5', borderBottom: '1px solid #f0f0f0' }}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                           <span>总进度</span>
                           <span>{Math.round((successCount / totalCount) * 100)}%</span>
                       </div>
                       <Progress percent={Math.round((successCount / totalCount) * 100)} showInfo={false} />
                       <div style={{ marginTop: 8, fontSize: 12, display: 'flex', gap: 16 }}>
                           <span style={{ color: '#52c41a' }}>成功: {successCount}</span>
                           <span style={{ color: '#ff4d4f' }}>失败: {failCount}</span>
                           <span style={{ color: '#1890ff' }}>进行中: {activeCount}</span>
                       </div>
                       {activeCount > 50 && <div style={{marginTop: 8, color: '#999'}}>还有 {activeCount - 50} 个任务未显示...</div>}
                   </div>
              )}

              <div style={{ overflowY: 'auto', padding: '12px', flex: 1 }}>
                  <List
                      dataSource={renderedTasks}
                      renderItem={item => (
                          <List.Item style={{ padding: '8px 0', display: 'block' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px', fontWeight: 500 }} title={item.fileName}>
                                      {item.fileName}
                                  </div>
                                  <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                      {item.status === 'success' ? '完成' : (item.status === 'exception' ? '失败' : `${item.percent}%`)}
                                  </div>
                              </div>
                              <Progress percent={item.percent} status={item.status === 'normal' ? 'active' : item.status as any} showInfo={false} size="small" />
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, alignItems: 'center' }}>
                                  <span style={{ fontSize: 12, color: '#666' }}>{item.message}</span>
                                  <Space size={4}>
                                      {item.status === 'exception' && (
                                          <Tooltip title="重试"><Button type="text" size="small" icon={<SyncOutlined />} onClick={() => handleRetryUpload(item.uid)} /></Tooltip>
                                      )}
                                      {item.status !== 'success' && item.status !== 'exception' && (
                                          item.isPaused ? (
                                              <Tooltip title="继续"><Button type="text" size="small" icon={<PlayCircleOutlined />} onClick={() => handleResumeUpload(item.uid)} /></Tooltip>
                                          ) : (
                                              <Tooltip title="暂停"><Button type="text" size="small" icon={<PauseCircleOutlined />} onClick={() => handlePauseUpload(item.uid)} /></Tooltip>
                                          )
                                      )}
                                      <Tooltip title="取消/移除"><Button type="text" size="small" icon={<CloseCircleOutlined />} onClick={() => handleCancelUpload(item.uid)} /></Tooltip>
                                  </Space>
                              </div>
                          </List.Item>
                      )}
                  />
                  {uploadListExpanded && totalCount > 100 && (
                      <div style={{ textAlign: 'center', padding: 10, color: '#999' }}>
                          仅显示前 100 个任务
                      </div>
                  )}
              </div>
          </Card>
      );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
            {isMobile && (
                <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerVisible(true)} style={{ marginRight: 16 }} />
            )}
            <div style={{ fontSize: '18px', fontWeight: 'bold', display: 'flex', alignItems: 'center', color: '#1890ff' }}>
                <CloudUploadOutlined style={{ marginRight: 8 }} /> 极速云存储
            </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
            <Dropdown menu={{ items: [
                { key: 'settings', label: '设置', icon: <SettingOutlined />, onClick: handleOpenSettings },
                { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, onClick: handleLogout }
            ] }}>
                <Space style={{ cursor: 'pointer' }}>
                    <Avatar style={{ backgroundColor: '#1890ff' }} icon={<UserOutlined />} />
                    {!isMobile && <span>{userInfo?.username}</span>}
                </Space>
            </Dropdown>
        </div>
      </Header>

      <Layout>
        {!isMobile && (
            <Sider width={220} style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <Menu mode="inline" defaultSelectedKeys={['files']} selectedKeys={[viewMode]} style={{ borderRight: 0, flex: 1, paddingTop: 16 }} onClick={handleMenuClick} items={menuItems} />
                    {userInfo && (
                        <div style={{ padding: 16, borderTop: '1px solid #f0f0f0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, justifyContent: 'space-between' }}>
                                <Space><HddOutlined /><Text strong>存储空间</Text></Space>
                                <Text type="secondary" style={{ fontSize: 12 }}>{Math.round((userInfo.quota_used / userInfo.quota_total) * 100)}%</Text>
                            </div>
                            <Progress percent={Math.min(100, Math.round((userInfo.quota_used / userInfo.quota_total) * 100))} showInfo={false} size="small" status={userInfo.quota_used >= userInfo.quota_total ? 'exception' : 'active'} />
                            <div style={{ marginTop: 4, fontSize: 12, color: '#666', textAlign: 'right' }}>{formatSize(userInfo.quota_used)} / {formatSize(userInfo.quota_total)}</div>
                        </div>
                    )}
                </div>
            </Sider>
        )}

        <Drawer title="菜单" placement="left" onClose={() => setDrawerVisible(false)} open={drawerVisible} width="70%" bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
                <Menu mode="inline" defaultSelectedKeys={['files']} selectedKeys={[viewMode]} style={{ borderRight: 0 }} onClick={handleMenuClick} items={menuItems} />
            </div>
            {userInfo && (
                <div style={{ padding: 16, borderTop: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, justifyContent: 'space-between' }}>
                        <Space><HddOutlined /><Text strong>存储空间</Text></Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>{Math.round((userInfo.quota_used / userInfo.quota_total) * 100)}%</Text>
                    </div>
                    <Progress percent={Math.min(100, Math.round((userInfo.quota_used / userInfo.quota_total) * 100))} showInfo={false} size="small" status={userInfo.quota_used >= userInfo.quota_total ? 'exception' : 'active'} />
                    <div style={{ marginTop: 4, fontSize: 12, color: '#666', textAlign: 'right' }}>{formatSize(userInfo.quota_used)} / {formatSize(userInfo.quota_total)}</div>
                </div>
            )}
        </Drawer>

        <Layout style={{ padding: isMobile ? '16px' : '24px' }}>
          {viewMode !== 'admin' && (
              <div style={{ marginBottom: 16 }}>
                 <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
                     {viewMode !== 'trash' && currentFolderId !== 0 && !isSearching && (
                         <Button icon={<ArrowUpOutlined />} onClick={handleGoUp} style={{ marginRight: 16 }} />
                     )}
                     {viewMode === 'trash' && currentFolderId !== 0 && !isSearching && (
                         <Button icon={<ArrowUpOutlined />} onClick={handleGoUp} style={{ marginRight: 16 }} />
                     )}
                     <Breadcrumb items={currentPath.map((item, index) => ({
                         title: <span onClick={() => handleBreadcrumbClick(item)} style={{ cursor: 'pointer', color: index === currentPath.length - 1 ? 'inherit' : '#1890ff' }}>{item.name}</span>
                     }))} />
                     {isSearching && (
                         <Button type="text" icon={<CloseCircleOutlined />} onClick={handleClearSearch} style={{ marginLeft: 8 }} danger>退出搜索</Button>
                     )}
                 </div>

                 {viewMode === 'files' && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {!isSearching && (
                            <>
                                <Button icon={<FolderAddOutlined />} onClick={() => setIsModalOpen(true)}>新建</Button>
                                <Button icon={<UploadOutlined />} type="primary" onClick={() => setUploadModalVisible(true)}>上传</Button>
                            </>
                        )}

                        <Input.Search
                            placeholder="搜索"
                            onSearch={handleSearch}
                            style={{ width: isMobile ? 120 : 200 }}
                            allowClear
                            value={searchKeyword}
                            onChange={e => setSearchKeyword(e.target.value)}
                        />

                        {!isSearching && selectedRowKeys.length > 0 && (
                            <Dropdown menu={{ items: [
                                { key: 'download', label: '批量下载', icon: <CloudDownloadOutlined />, onClick: handleBatchDownload },
                                { key: 'delete', label: '批量删除', icon: <DeleteOutlined />, danger: true, onClick: handleBatchDelete },
                                { key: 'copy', label: '复制', icon: <CopyOutlined />, onClick: handleCopy },
                                { key: 'cut', label: '剪切', icon: <ScissorOutlined />, onClick: handleCut },
                            ] }}>
                                <Button icon={<MoreOutlined />}>操作 ({selectedRowKeys.length})</Button>
                            </Dropdown>
                        )}

                        {!isSearching && clipboard && (
                            <Button icon={<SnippetsOutlined />} type="dashed" onClick={handlePaste}>
                                粘贴 ({clipboard.items.length})
                            </Button>
                        )}
                    </div>
                 )}

                 {viewMode === 'trash' && selectedRowKeys.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Button icon={<UndoOutlined />} onClick={handleBatchRestore}>批量还原</Button>
                        <Button icon={<DeleteOutlined />} danger onClick={handleBatchPermanentDelete}>批量彻底删除</Button>
                    </div>
                 )}
              </div>
          )}

          <Content style={{ background: '#fff', padding: 0, borderRadius: 8, minHeight: 280, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            {viewMode === 'admin' ? (
                <Table columns={userColumns} dataSource={users} rowKey="id" loading={loading} pagination={false} scroll={{ x: 600 }} />
            ) : (
                isMobile ? (
                    <List
                        dataSource={files}
                        loading={loading}
                        header={
                            files.length > 0 && (viewMode === 'files' || viewMode === 'trash') ? (
                                <div style={{ padding: '0 16px', borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>
                                    <Checkbox
                                        checked={files.length > 0 && selectedRowKeys.length === files.length}
                                        indeterminate={selectedRowKeys.length > 0 && selectedRowKeys.length < files.length}
                                        onChange={handleSelectAll}
                                    >
                                        全选
                                    </Checkbox>
                                </div>
                            ) : null
                        }
                        renderItem={item => (
                            <List.Item
                                style={{ padding: 0 }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '12px 16px' }}>
                                    <Checkbox
                                        checked={selectedRowKeys.includes(item.id)}
                                        onChange={() => handleMobileSelect(item)}
                                        style={{ marginRight: 16 }}
                                    />
                                    <div
                                        style={{ flex: 1, display: 'flex', alignItems: 'center', cursor: 'pointer', minWidth: 0 }}
                                        onClick={() => handleFolderClick(item)}
                                    >
                                        {getFileIcon(item.file_name, item.is_folder)}
                                        <div style={{ marginLeft: 12, flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file_name}</div>
                                            <div style={{ fontSize: 12, color: '#8c8c8c', display: 'flex', justifyContent: 'space-between' }}>
                                                <span>{item.is_folder ? '-' : formatSize(item.file_size)}</span>
                                                <span style={{ marginLeft: 8 }}>{item.updated_at ? new Date(item.updated_at.endsWith('Z') ? item.updated_at : item.updated_at + 'Z').toLocaleString() : '-'}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ marginLeft: 8 }}>
                                        <Dropdown menu={{ items: [
                                            ...(viewMode === 'files' ? [
                                                { key: 'rename', label: '重命名', icon: <EditOutlined />, onClick: () => handleRename(item) }
                                            ] : []),
                                            ...(viewMode === 'files' ? [
                                                { key: 'share', label: '分享', icon: <ShareAltOutlined />, onClick: () => handleShare(item) },
                                            ] : []),
                                            ...(viewMode === 'files' && !item.is_folder ? [
                                                { key: 'preview', label: '预览', icon: <EyeOutlined />, onClick: () => handlePreview(item) },
                                            ] : []),
                                            ...(viewMode === 'files' ? [
                                                { key: 'download', label: '下载', icon: <DownloadOutlined />, onClick: () => handleDownload(item) }
                                            ] : []),
                                            ...(viewMode === 'trash' ? [
                                                { key: 'restore', label: '还原', icon: <UndoOutlined />, onClick: () => handleRestore(item) },
                                                { key: 'delete', label: '彻底删除', icon: <DeleteOutlined />, danger: true, onClick: () => handlePermanentDelete(item) }
                                            ] : [
                                                { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => handleDelete(item) }
                                            ])
                                        ] }} trigger={['click']}>
                                            <Button type="text" icon={<MoreOutlined />} style={{ fontSize: '20px' }} />
                                        </Dropdown>
                                    </div>
                                </div>
                            </List.Item>
                        )}
                    />
                ) : (
                    <Table
                        rowSelection={viewMode === 'files' || viewMode === 'trash' ? rowSelection : undefined}
                        columns={columns}
                        dataSource={files}
                        rowKey="id"
                        loading={loading}
                        pagination={false}
                        locale={{ emptyText: <Empty description={viewMode === 'trash' ? '回收站为空' : '暂无文件'} /> }}
                    />
                )
            )}
          </Content>
        </Layout>
      </Layout>

      {/* Modals */}
      <Modal title="新建文件夹" open={isModalOpen} onOk={handleCreateFolder} onCancel={() => setIsModalOpen(false)} okText="确定" cancelText="取消">
        <Input placeholder="请输入文件夹名称" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} />
      </Modal>

      <Modal title="重命名" open={renameModalVisible} onOk={handleConfirmRename} onCancel={() => setRenameModalVisible(false)} okText="确定" cancelText="取消">
        <Input value={newFileName} onChange={e => setNewFileName(e.target.value)} />
      </Modal>

      {/* Settings Modal */}
      <Modal
        title="设置"
        open={settingsModalVisible}
        onCancel={() => setSettingsModalVisible(false)}
        footer={null}
        width={600}
      >
          <Tabs defaultActiveKey="1" items={[
              {
                  key: '1',
                  label: <span><IdcardOutlined />个人信息</span>,
                  children: (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                          <Card size="small" title="修改用户名">
                              <Form form={usernameForm} layout="vertical" onFinish={handleUpdateUsername}>
                                  <Form.Item name="username" label="新用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                                      <Input prefix={<UserOutlined />} />
                                  </Form.Item>
                                  <Form.Item style={{ marginBottom: 0 }}>
                                      <Button type="primary" htmlType="submit" block>保存用户名</Button>
                                  </Form.Item>
                              </Form>
                          </Card>

                          <Card size="small" title="修改绑定邮箱">
                              <Form form={emailForm} layout="vertical" onFinish={handleUpdateEmail}>
                                  <Form.Item name="email" label="新邮箱" rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '请输入有效的邮箱地址' }]}>
                                      <Input prefix={<MailOutlined />} />
                                  </Form.Item>
                                  <Form.Item label="验证码" required>
                                      <Row gutter={8}>
                                          <Col span={16}>
                                              <Form.Item name="email_code" noStyle rules={[{ required: true, message: '请输入验证码' }]}>
                                                  <Input prefix={<SafetyCertificateOutlined />} placeholder="请输入验证码" />
                                              </Form.Item>
                                          </Col>
                                          <Col span={8}>
                                              <Button block onClick={handleSendEmailCode} disabled={countdown > 0}>
                                                  {countdown > 0 ? `${countdown}s` : '发送验证码'}
                                              </Button>
                                          </Col>
                                      </Row>
                                  </Form.Item>
                                  <Form.Item style={{ marginBottom: 0 }}>
                                      <Button type="primary" htmlType="submit" block>保存邮箱</Button>
                                  </Form.Item>
                              </Form>
                          </Card>
                      </div>
                  )
              },
              {
                  key: '2',
                  label: <span><LockOutlined />安全设置</span>,
                  children: (
                      <Form form={passwordForm} layout="vertical" onFinish={handleUpdatePassword}>
                          <Form.Item name="current_password" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
                              <Input.Password />
                          </Form.Item>
                          <Form.Item name="new_password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '密码长度不能少于6位' }]}>
                              <Input.Password />
                          </Form.Item>
                          <Form.Item name="confirm_password" label="确认新密码" rules={[{ required: true, message: '请再次输入新密码' }]}>
                              <Input.Password />
                          </Form.Item>
                          <Form.Item>
                              <Button type="primary" htmlType="submit" block>修改密码</Button>
                          </Form.Item>
                      </Form>
                  )
              },
              ...(!isMobile ? [{
                  key: '3',
                  label: <span><DesktopOutlined />其他</span>,
                  children: (
                      <div style={{ padding: '20px 0', textAlign: 'center' }}>
                          <p>将极速云存储添加到您的桌面，像原生应用一样使用。</p>
                          <Button type="primary" icon={<DesktopOutlined />} onClick={handleAddToDesktop}>
                              添加到桌面快捷方式
                          </Button>
                      </div>
                  )
              }] : [])
          ]} />
      </Modal>

      {/* Upload Choice Modal */}
      <Modal
        title="上传文件"
        open={uploadModalVisible}
        onCancel={() => setUploadModalVisible(false)}
        footer={null}
        width={500}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: '20px 0' }}>
            <Upload.Dragger
                customRequest={(options) => {
                    if (uploadModalVisible) setUploadModalVisible(false);
                    customRequest(options);
                }}
                showUploadList={false}
                multiple
                style={{ padding: 20 }}
            >
                <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
                <p className="ant-upload-hint">
                    支持单个或批量文件上传
                </p>
            </Upload.Dragger>

            <div style={{ textAlign: 'center', borderTop: '1px solid #f0f0f0', paddingTop: 20 }}>
                 <Upload
                    customRequest={(options) => {
                        if (uploadModalVisible) setUploadModalVisible(false);
                        customRequest(options);
                    }}
                    showUploadList={false}
                    directory
                >
                    <Button icon={<FolderOutlined />} size="large" block>上传文件夹</Button>
                 </Upload>
            </div>
        </div>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        title="编辑用户"
        open={editUserModalVisible}
        onOk={handleUpdateUser}
        onCancel={() => setEditUserModalVisible(false)}
        okText="保存"
        cancelText="取消"
      >
          <Form form={userForm} layout="vertical">
              <Form.Item name="quota_total_gb" label="存储配额 (GB)" rules={[{ required: true }]}>
                  <InputNumber min={0.1} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="is_admin" label="管理员权限" valuePropName="checked">
                  <Switch />
              </Form.Item>
          </Form>
      </Modal>

      {/* Conflict Resolver Modal */}
      <Modal
        title={
            <div style={{display: 'flex', alignItems: 'center', color: '#faad14'}}>
                <ExclamationCircleOutlined style={{marginRight: 8}} /> 文件名冲突
            </div>
        }
        open={conflictModal.visible}
        closable={false}
        maskClosable={false}
        footer={null}
      >
          <div style={{ marginBottom: 24 }}>
              <p>文件夹中已存在名为 <strong>{conflictModal.fileName}</strong> 的文件。</p>
              <p>请选择处理方式：</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Button onClick={() => conflictModal.resolve('rename', conflictStrategyRef.current?.applyToAll || false)}>
                  保留两者 (自动重命名)
              </Button>
              <Button onClick={() => conflictModal.resolve('replace', conflictStrategyRef.current?.applyToAll || false)}>
                  替换 (删除旧文件)
              </Button>
              <Button onClick={() => conflictModal.resolve('skip', conflictStrategyRef.current?.applyToAll || false)}>
                  跳过
              </Button>
          </div>

          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
              <Checkbox onChange={e => {
                  if (conflictStrategyRef.current) {
                      conflictStrategyRef.current.applyToAll = e.target.checked;
                  } else {
                      conflictStrategyRef.current = { action: 'skip', applyToAll: e.target.checked };
                  }
              }}>
                  应用到后续所有冲突
              </Checkbox>
          </div>
      </Modal>

      {/* Render Optimized Upload List */}
      {uploadListVisible && uploadTasks.length > 0 && renderUploadList()}

      {/* Download Progress Modal */}
      {downloadState.visible && (
          <Card
            style={{ position: 'fixed', bottom: 24, right: 24, width: 320, zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
            title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <CloudDownloadOutlined style={{ marginRight: 8 }} />
                        <span style={{ fontSize: 14 }}>下载进度</span>
                    </div>
                    <Button type="text" icon={<CloseCircleOutlined />} onClick={handleCancelDownload} title="取消" />
                </div>
            }
            size="small"
          >
              <div style={{ marginBottom: 8, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {downloadState.fileName}
              </div>
              <Progress percent={downloadState.percent} status={downloadState.status === 'normal' ? 'active' : downloadState.status} />
              <div style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
                  {downloadState.message}
              </div>
          </Card>
      )}

      {/* Preview Modal */}
      <Modal
        title={previewFile?.file_name}
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={800}
        destroyOnClose
      >
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minHeight: 400, overflow: 'auto', maxHeight: 600 }}>
              {previewLoading && <Spin size="large" style={{ marginTop: 100 }} />}

              {!previewLoading && previewType === 'image' && (
                  <img src={previewUrl} alt="preview" style={{ maxWidth: '100%', maxHeight: 600 }} />
              )}
              {!previewLoading && previewType === 'video' && (
                  <video src={previewUrl} controls style={{ maxWidth: '100%', maxHeight: 600 }} />
              )}
              {!previewLoading && previewType === 'pdf' && (
                  <iframe src={previewUrl} style={{ width: '100%', height: 600, border: 'none' }} />
              )}
              {!previewLoading && previewType === 'text' && (
                  <pre style={{ textAlign: 'left', width: '100%', whiteSpace: 'pre-wrap', wordWrap: 'break-word', padding: 10, background: '#f5f5f5', borderRadius: 4, margin: 0 }}>
                      {previewContent}
                  </pre>
              )}
              {!previewLoading && previewType === 'docx' && (
                  <div ref={docxContainerRef} style={{ width: '100%', background: '#fff', padding: 20, minHeight: 600 }} className="docx-preview" />
              )}
              {!previewLoading && previewType === 'excel' && (
                  <div
                    dangerouslySetInnerHTML={{ __html: previewContent }}
                    style={{ width: '100%', overflow: 'auto' }}
                    className="excel-preview"
                  />
              )}
              {!previewLoading && previewType === 'other' && (
                  <div style={{ textAlign: 'center', marginTop: 100 }}>
                      <p>该文件类型暂不支持在线预览</p>
                      <Button type="primary" onClick={() => previewFile && handleDownload(previewFile)}>
                          下载查看
                      </Button>
                  </div>
              )}
          </div>
      </Modal>

      {/* Share Modal */}
      <Modal
        title="分享文件"
        open={shareModalVisible}
        onCancel={() => setShareModalVisible(false)}
        footer={null}
      >
          {!shareLink ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Checkbox checked={isPrivateShare} onChange={e => setIsPrivateShare(e.target.checked)}>
                      私密分享（需要提取码）
                  </Checkbox>

                  <div>
                      <div style={{ marginBottom: 8 }}>有效期：</div>
                      <Radio.Group value={shareExpireType} onChange={e => setShareExpireType(e.target.value)}>
                          <Radio value="forever">永久有效</Radio>
                          <Radio value="custom">自定义</Radio>
                      </Radio.Group>
                      {shareExpireType === 'custom' && (
                          <div style={{ marginTop: 8 }}>
                              <DatePicker
                                  showTime
                                  value={shareExpireDate}
                                  onChange={setShareExpireDate}
                                  placeholder="选择过期时间"
                                  style={{ width: '100%' }}
                              />
                          </div>
                      )}
                  </div>

                  <div>
                      <div style={{ marginBottom: 8 }}>下载/查看次数限制：</div>
                      <Radio.Group value={shareDownloadLimitType} onChange={e => setShareDownloadLimitType(e.target.value)}>
                          <Radio value="unlimited">无限次</Radio>
                          <Radio value="custom">自定义</Radio>
                      </Radio.Group>
                      {shareDownloadLimitType === 'custom' && (
                          <div style={{ marginTop: 8 }}>
                              <InputNumber
                                  min={1}
                                  value={shareDownloadLimit}
                                  onChange={setShareDownloadLimit}
                                  placeholder="输入次数"
                                  style={{ width: '100%' }}
                              />
                          </div>
                      )}
                  </div>

                  <Button type="primary" onClick={createShareLink}>创建链接</Button>
              </div>
          ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                      <div style={{ marginBottom: 8 }}>分享链接：</div>
                      <Input.Group compact>
                          <Input style={{ width: 'calc(100% - 60px)' }} value={shareLink} readOnly />
                          <Button onClick={() => { navigator.clipboard.writeText(shareLink); message.success('已复制'); }}>复制</Button>
                      </Input.Group>
                  </div>
                  {shareAccessCode && (
                      <div>
                          <div style={{ marginBottom: 8 }}>提取码：</div>
                          <Input.Group compact>
                              <Input style={{ width: '100px' }} value={shareAccessCode} readOnly />
                              <Button onClick={() => { navigator.clipboard.writeText(shareAccessCode); message.success('已复制'); }}>复制</Button>
                          </Input.Group>
                      </div>
                  )}
              </div>
          )}
      </Modal>

      {/* Excel Styles */}
      <style>{`
        .excel-preview table {
            border-collapse: collapse;
            width: max-content;
            min-width: 100%;
        }
        .excel-preview td, .excel-preview th {
            border: 1px solid #ccc;
            padding: 4px 8px;
            font-family: Arial, sans-serif;
            font-size: 13px;
        }
        .excel-preview tr:nth-child(even){background-color: #f9f9f9;}
        .excel-preview tr:hover {background-color: #f1f1f1;}
        .excel-preview th {
            padding-top: 8px;
            padding-bottom: 8px;
            text-align: center;
            background-color: #f3f3f3;
            color: #333;
            font-weight: bold;
        }
        .docx-preview {
            font-family: "Calibri", "Times New Roman", serif;
            line-height: 1.6;
        }
        .docx-preview p {
            margin-bottom: 1em;
        }
        .docx-preview table {
            border-collapse: collapse;
            width: 100%;
            margin-bottom: 1em;
        }
        .docx-preview td, .docx-preview th {
            border: 1px solid #000;
            padding: 5px;
        }
      `}</style>
    </Layout>
  );
};

export default Dashboard;