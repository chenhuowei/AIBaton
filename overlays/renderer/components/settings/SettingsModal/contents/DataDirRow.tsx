/**
 * About-page data directory row (Aibaton).
 *
 * Shows the real Tauri `app_data_dir()` — this is where the SQLite database,
 * logs, work dir and the downloaded Node.js runtime live. Provides copy and
 * "open folder" actions. Uses Tauri IPC/opener directly so it does not depend
 * on Electron-only IPC channels.
 */

import { invoke, isTauri } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import { Button, Message, Typography } from '@arco-design/web-react';
import { Copy, FolderOpen } from '@icon-park/react';
import React, { useEffect, useState } from 'react';

export const DataDirRow: React.FC = () => {
  const [dir, setDir] = useState<string>('');

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<string>('get_data_dir')
      .then(setDir)
      .catch((e) => console.warn('[aibaton] get_data_dir failed:', e));
  }, []);

  if (!dir) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dir);
      Message.success('Copied');
    } catch {
      Message.warning('Clipboard unavailable');
    }
  };

  const open = async () => {
    try {
      await openPath(dir);
    } catch (e) {
      console.error('[aibaton] open data dir failed:', e);
      Message.error('Could not open folder');
    }
  };

  return (
    <div className='flex flex-col gap-8px mb-16px w-full'>
      <Typography.Text className='text-12px text-t-secondary'>Data directory</Typography.Text>
      <div className='flex items-center gap-8px'>
        <code className='flex-1 min-w-0 text-12px px-8px py-6px rd-6px bg-fill-2 text-t-primary overflow-hidden text-ellipsis whitespace-nowrap'>
          {dir}
        </code>
        <Button size='mini' icon={<Copy theme='outline' size='13' />} onClick={() => void copy()} aria-label='Copy path' />
        <Button size='mini' icon={<FolderOpen theme='outline' size='13' />} onClick={() => void open()}>
          Open
        </Button>
      </div>
      <Typography.Text className='text-11px text-t-tertiary'>
        Chat history, settings, logs and the downloaded Node.js runtime are stored here.
      </Typography.Text>
    </div>
  );
};

export default DataDirRow;
