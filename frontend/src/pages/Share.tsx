import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Button, Input, message, Spin, Typography, Space, Progress, Table, Breadcrumb, Modal, Tooltip, Empty, List, Checkbox, Grid, Dropdown, Tag } from 'antd';
import { FileOutlined, DownloadOutlined, CloseCircleOutlined, FolderOutlined, FileImageOutlined, FilePdfOutlined, FileWordOutlined, FileExcelOutlined, FileZipOutlined, VideoCameraOutlined, FileTextOutlined, EyeOutlined, MoreOutlined, ClockCircleOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import request from '../utils/request';
import mammoth from 'mammoth';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

interface ShareInfo {
    share_key: string;
    is_private: boolean;
    file_name: string;
    file_size: number;
    is_folder: boolean;
    expire_at?: string;
    max_downloads?: number;
    download_count?: number;
    file_id: number;
}

interface FileMeta {
  id: number;
  file_name: string;
  is_folder: boolean;
  file_size: number;
  parent_id: number;
  updated_at?: string;
}

interface DownloadState {
    visible: boolean;
    fileName: string;
    percent: number;
    status: 'active' | 'exception' | 'success' | 'normal';
    message: string;
}

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

const SharePage: React.FC = () => {
    const { shareKey } = useParams<{ shareKey: string }>();
    const screens = useBreakpoint();
    const isMobile = screens.md === false || (screens.md === undefined && window.innerWidth < 768);

    const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [accessCode, setAccessCode] = useState('');
    const [isVerified, setIsVerified] = useState(false);
    
    // Folder View State
    const [files, setFiles] = useState<FileMeta[]>([]);
    const [currentPath, setCurrentPath] = useState<{id: number, name: string}[]>([]);
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
    const [selectedRows, setSelectedRows] = useState<FileMeta[]>([]);
    const [folderLoading, setFolderLoading] = useState(false);

    // Preview State
    const [previewVisible, setPreviewVisible] = useState(false);
    const [previewFile, setPreviewFile] = useState<FileMeta | null>(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [previewType, setPreviewType] = useState<'image' | 'video' | 'pdf' | 'text' | 'docx' | 'excel' | 'other'>('other');
    const [previewContent, setPreviewContent] = useState<any>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const docxContainerRef = useRef<HTMLDivElement>(null);

    // Download State
    const [downloadState, setDownloadState] = useState<DownloadState>({
        visible: false,
        fileName: '',
        percent: 0,
        status: 'normal',
        message: ''
    });
    const downloadAbortControllerRef = useRef<AbortController | null>(null);

    const fetchShareInfo = async () => {
        try {
            const res: any = await request.get(`/shares/${shareKey}`);
            setShareInfo(res);
            
            // Check local storage for saved access code
            const savedAccessCode = localStorage.getItem(`share_access_code_${shareKey}`);
            if (savedAccessCode) {
                setAccessCode(savedAccessCode);
            }

            if (!res.is_private) {
                setIsVerified(true);
                if (res.is_folder) {
                    fetchFolderContents(res.file_id, res.file_name, true, '');
                }
            } else if (savedAccessCode) {
                // Try to verify automatically if we have a saved code
                handleCheckAccessCode(savedAccessCode, res);
            }
        } catch (err: any) {
            if (err.response?.status === 404) {
                setError('分享不存在');
            } else if (err.response?.status === 410) {
                setError('分享已过期或已达下载上限');
            } else {
                setError('获取分享信息失败');
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchShareInfo();
    }, [shareKey]);

    const fetchFolderContents = async (folderId: number, folderName?: string, isRoot: boolean = true, code: string = accessCode) => {
        setFolderLoading(true);
        try {
            const res: any = await request.get(`/shares/${shareKey}/contents`, {
                params: { 
                    access_code: code,
                    folder_id: folderId
                }
            });
            setFiles(res);
            if (isRoot) {
                setCurrentPath([{ id: folderId, name: folderName || '根目录' }]);
            }
        } catch (error) {
            message.error('加载文件夹内容失败');
            throw error; // Re-throw to handle in caller
        } finally {
            setFolderLoading(false);
        }
    };

    const handleCheckAccessCode = async (code: string = accessCode, info: ShareInfo | null = shareInfo) => {
        if (!shareKey || !info) return;
        try {
            // Try to fetch contents if folder, or just verify for file
            if (info.is_folder) {
                await fetchFolderContents(info.file_id, info.file_name, true, code);
            } else {
                // For single file, we can't really "verify" without downloading.
                // But we can try to verify by calling contents endpoint with root folder id if possible, 
                // or just let user proceed.
                // To improve UX, we assume verified. Real verification happens on download.
            }
            setIsVerified(true);
            // Save access code to local storage
            localStorage.setItem(`share_access_code_${shareKey}`, code);
            if (code !== accessCode) {
                setAccessCode(code);
            }
        } catch (error) {
            if (code !== accessCode) {
                 // If auto-verify failed, clear invalid saved code
                 localStorage.removeItem(`share_access_code_${shareKey}`);
            } else {
                message.error('提取码错误');
            }
        }
    };

    const handleCancelDownload = () => {
        if (downloadAbortControllerRef.current) {
            downloadAbortControllerRef.current.abort();
        }
        setDownloadState(prev => ({ ...prev, visible: false }));
        message.info('下载已取消');
    };

    // Download the ROOT share item (Folder or File)
    const handleDownload = async () => {
        if (!shareKey) return;
        downloadAbortControllerRef.current = new AbortController();
        try {
            setDownloadState({
                visible: true,
                fileName: shareInfo?.file_name || 'download',
                percent: 0,
                status: 'active',
                message: '开始下载...'
            });

            const response: any = await request.post(`/shares/${shareKey}/download`,
                { access_code: accessCode },
                {
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
                }
            );

            // Fix: Wrap response in Blob, do NOT use response.data
            const url = window.URL.createObjectURL(new Blob([response]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', shareInfo?.is_folder ? `${shareInfo?.file_name}.zip` : (shareInfo?.file_name || 'download'));
            document.body.appendChild(link);
            link.click();
            link.remove();

            setDownloadState(prev => ({ ...prev, percent: 100, status: 'success', message: '下载完成' }));
            setTimeout(() => {
                setDownloadState(prev => ({ ...prev, visible: false }));
                fetchShareInfo(); // Refresh share info to update download count
            }, 2000);
        } catch (err: any) {
            if (err.name === 'Canceled' || err.message === 'canceled') {
                return;
            }
            if (err.response?.status === 403) {
                setDownloadState(prev => ({ ...prev, status: 'exception', message: '提取码错误' }));
                setIsVerified(false);
                localStorage.removeItem(`share_access_code_${shareKey}`);
            } else {
                setDownloadState(prev => ({ ...prev, status: 'exception', message: '下载失败' }));
            }
            setTimeout(() => setDownloadState(prev => ({ ...prev, visible: false })), 2000);
        }
    };

    const handleFolderClick = (record: FileMeta) => {
        if (record.is_folder) {
            const newPath = [...currentPath, { id: record.id, name: record.file_name }];
            setCurrentPath(newPath);
            fetchFolderContents(record.id, record.file_name, false);
        }
    };

    const handleBreadcrumbClick = (item: {id: number, name: string}, index: number) => {
        const newPath = currentPath.slice(0, index + 1);
        setCurrentPath(newPath);
        fetchFolderContents(item.id, item.name, false);
    };

    // Batch download multiple items (Always Zip)
    const handleBatchDownload = async () => {
        if (selectedRowKeys.length === 0) return;
        downloadAbortControllerRef.current = new AbortController();
        const fileName = `shared_batch_download_${new Date().getTime()}.zip`;
        try {
            setDownloadState({
                visible: true,
                fileName: fileName,
                percent: 0,
                status: 'active',
                message: '正在打包下载...'
            });

            const response: any = await request.post(`/shares/${shareKey}/batch_download`,
                {
                    file_ids: selectedRowKeys,
                    access_code: accessCode
                },
                {
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
                }
            );

            // Fix: Wrap response in Blob
            const url = window.URL.createObjectURL(new Blob([response]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', fileName);
            document.body.appendChild(link);
            link.click();
            link.remove();

            setDownloadState(prev => ({ ...prev, percent: 100, status: 'success', message: '下载完成' }));
            setTimeout(() => {
                setDownloadState(prev => ({ ...prev, visible: false }));
                fetchShareInfo(); // Refresh share info to update download count
                setSelectedRowKeys([]);
                setSelectedRows([]);
            }, 2000);

        } catch (error: any) {
            if (error.name === 'Canceled' || error.message === 'canceled') {
                return;
            }
            setDownloadState(prev => ({ ...prev, status: 'exception', message: '批量下载失败' }));
            setTimeout(() => setDownloadState(prev => ({ ...prev, visible: false })), 2000);
        }
    };

    const handlePreview = async (record: FileMeta) => {
        const url = `/api/v1/shares/${shareKey}/preview/${record.id}?access_code=${accessCode}`;
        const excelUrl = `/api/v1/shares/${shareKey}/preview/excel/${record.id}?access_code=${accessCode}`;

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

    // Effect to render docx
    useEffect(() => {
        if (previewVisible && previewType === 'docx' && previewContent && docxContainerRef.current) {
            docxContainerRef.current.innerHTML = previewContent;
        }
    }, [previewVisible, previewType, previewContent]);

    // Download a single item from the list
    const downloadSharedItem = async (record: FileMeta) => {
        downloadAbortControllerRef.current = new AbortController();

        // Logic change: If it's a folder, ensure .zip extension. If file, keep original name.
        const fileName = record.is_folder ? `${record.file_name}.zip` : record.file_name;

        try {
            setDownloadState({
                visible: true,
                fileName: fileName,
                percent: 0,
                status: 'active',
                message: record.is_folder ? '正在打包下载...' : '开始下载...'
            });

            let response: any;

            // Logic change: Separate API calls for File vs Folder
            if (record.is_folder) {
                 // Folder: Use batch_download (Server creates ZIP)
                 response = await request.post(`/shares/${shareKey}/batch_download`,
                    {
                        file_ids: [record.id],
                        access_code: accessCode
                    },
                    {
                        responseType: 'blob',
                        timeout: 0,
                        signal: downloadAbortControllerRef.current.signal,
                        onDownloadProgress: (progressEvent) => {
                            handleProgress(progressEvent);
                        }
                    }
                );
            } else {
                // File: Use new single file download endpoint (Server streams file)
                // This assumes the backend route added: POST /shares/{shareKey}/download/{fileId}
                response = await request.post(`/shares/${shareKey}/download/${record.id}`,
                    {
                        access_code: accessCode
                    },
                    {
                        responseType: 'blob',
                        timeout: 0,
                        signal: downloadAbortControllerRef.current.signal,
                        onDownloadProgress: (progressEvent) => {
                            handleProgress(progressEvent);
                        }
                    }
                );
            }

            function handleProgress(progressEvent: any) {
                const { loaded, total } = progressEvent;
                if (total) {
                    const percent = Math.round((loaded / total) * 100);
                    setDownloadState(prev => ({ ...prev, percent, message: `正在下载... ${percent}%` }));
                } else {
                    setDownloadState(prev => ({ ...prev, message: `正在下载... ${formatSize(loaded)}` }));
                }
            }

            // Fix: Wrap response in Blob
            const url = window.URL.createObjectURL(new Blob([response]));

            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', fileName);
            document.body.appendChild(link);
            link.click();
            link.remove();

            setDownloadState(prev => ({ ...prev, percent: 100, status: 'success', message: '下载完成' }));
            setTimeout(() => {
                setDownloadState(prev => ({ ...prev, visible: false }));
                fetchShareInfo(); // Refresh share info to update download count
            }, 2000);
        } catch (error: any) {
            if (error.name === 'Canceled' || error.message === 'canceled') {
                return;
            }
            setDownloadState(prev => ({ ...prev, status: 'exception', message: '下载失败' }));
            setTimeout(() => setDownloadState(prev => ({ ...prev, visible: false })), 2000);
        }
    }

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
            width: 100,
            render: (_: any, record: FileMeta) => (
                <Space>
                    {!record.is_folder && (
                        <Tooltip title="预览"><Button type="text" icon={<EyeOutlined />} onClick={(e) => { e.stopPropagation(); handlePreview(record); }} /></Tooltip>
                    )}
                    <Tooltip title="下载"><Button type="text" icon={<DownloadOutlined />} onClick={(e) => {
                        e.stopPropagation();
                        downloadSharedItem(record);
                    }} /></Tooltip>
                </Space>
            )
        }
    ];

    // Mobile List Item Selection
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

    if (loading) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><Spin size="large" /></div>;
    }

    if (error) {
        return <div style={{ textAlign: 'center', marginTop: 100 }}><Title level={3}>{error}</Title></div>;
    }

    return (
        <div style={{ minHeight: '100vh', background: '#f0f2f5', padding: isMobile ? '16px' : '24px' }}>
            <Card style={{ maxWidth: 1000, margin: '0 auto', minHeight: '80vh' }} bodyStyle={{ padding: isMobile ? '16px' : '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 0 }}>
                    <Space style={{ width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'center' : 'flex-start' }}>
                        <FileOutlined style={{ fontSize: 24, color: '#1890ff' }} />
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <Title level={4} style={{ margin: 0, wordBreak: 'break-all' }}>{shareInfo?.file_name}</Title>
                            <Space size="small" style={{ marginTop: 4 }}>
                                {shareInfo?.expire_at && (
                                    <Tag icon={<ClockCircleOutlined />} color="warning">
                                        {dayjs(shareInfo.expire_at.endsWith('Z') ? shareInfo.expire_at : shareInfo.expire_at + 'Z').format('YYYY-MM-DD HH:mm')} 过期
                                    </Tag>
                                )}
                                {shareInfo?.max_downloads !== undefined && shareInfo?.max_downloads !== null && shareInfo?.max_downloads !== -1 && (
                                    <Tag icon={<CloudDownloadOutlined />} color="blue">
                                        剩余下载: {Math.max(0, shareInfo.max_downloads - (shareInfo.download_count || 0))} 次
                                    </Tag>
                                )}
                            </Space>
                        </div>
                    </Space>
                    {isVerified && shareInfo?.is_folder && (
                        <Space style={{ width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'center' : 'flex-end' }}>
                            <Button icon={<DownloadOutlined />} type="primary" onClick={handleDownload}>下载全部</Button>
                            {selectedRowKeys.length > 0 && (
                                <Button icon={<DownloadOutlined />} onClick={handleBatchDownload}>批量下载 ({selectedRowKeys.length})</Button>
                            )}
                        </Space>
                    )}
                </div>

                {!isVerified && shareInfo?.is_private ? (
                    <div style={{ maxWidth: 400, margin: '100px auto', textAlign: 'center' }}>
                        <Title level={5} style={{ marginBottom: 24 }}>请输入提取码访问文件</Title>
                        <Space.Compact style={{ width: '100%' }}>
                            <Input
                                placeholder="请输入提取码"
                                value={accessCode}
                                onChange={(e) => setAccessCode(e.target.value)}
                                onPressEnter={() => handleCheckAccessCode()}
                            />
                            <Button type="primary" onClick={() => handleCheckAccessCode()}>提取</Button>
                        </Space.Compact>
                    </div>
                ) : (
                    shareInfo?.is_folder ? (
                        <>
                            <div style={{ marginBottom: 16 }}>
                                <Breadcrumb items={currentPath.map((item, index) => ({
                                    title: <span onClick={() => handleBreadcrumbClick(item, index)} style={{ cursor: 'pointer', color: index === currentPath.length - 1 ? 'inherit' : '#1890ff' }}>{item.name}</span>
                                }))} />
                            </div>

                            {isMobile ? (
                                <List
                                    dataSource={files}
                                    loading={folderLoading}
                                    header={
                                        files.length > 0 ? (
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
                                        <List.Item style={{ padding: 0 }}>
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
                                                        ...(!item.is_folder ? [
                                                            { key: 'preview', label: '预览', icon: <EyeOutlined />, onClick: () => handlePreview(item) },
                                                        ] : []),
                                                        { key: 'download', label: '下载', icon: <DownloadOutlined />, onClick: () => downloadSharedItem(item) }
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
                                    rowSelection={{
                                        selectedRowKeys,
                                        onChange: (newSelectedRowKeys: React.Key[], newSelectedRows: FileMeta[]) => {
                                            setSelectedRowKeys(newSelectedRowKeys);
                                            setSelectedRows(newSelectedRows);
                                        }
                                    }}
                                    columns={columns}
                                    dataSource={files}
                                    rowKey="id"
                                    loading={folderLoading}
                                    pagination={false}
                                    locale={{ emptyText: <Empty description="暂无文件" /> }}
                                />
                            )}
                        </>
                    ) : (
                        <div style={{ textAlign: 'center', marginTop: isMobile ? 40 : 100 }}>
                            <FileOutlined style={{ fontSize: isMobile ? 48 : 64, color: '#1890ff', marginBottom: 24 }} />
                            <Title level={4} style={{ wordBreak: 'break-all' }}>{shareInfo?.file_name}</Title>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>{formatSize(shareInfo?.file_size || 0)}</Text>
                            <Button
                                type="primary"
                                icon={<DownloadOutlined />}
                                size="large"
                                onClick={handleDownload}
                            >
                                下载文件
                            </Button>
                        </div>
                    )
                )}
            </Card>

            {/* Download Progress Modal */}
            {downloadState.visible && (
                <Card
                    style={{ position: 'fixed', bottom: 24, right: 24, width: 320, zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
                    title={
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                <DownloadOutlined style={{ marginRight: 8 }} />
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
                            <Button type="primary" onClick={() => previewFile && downloadSharedItem(previewFile)}>
                                下载查看
                            </Button>
                        </div>
                    )}
                </div>
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
        </div>
    );
};

export default SharePage;