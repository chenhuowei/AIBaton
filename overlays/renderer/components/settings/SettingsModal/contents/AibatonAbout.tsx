/**
 * Aibaton About page content.
 *
 * Replaces upstream AionUi's wiki / releases / official-website / Twitter
 * links with project-native material: brand mark, description, version,
 * repository link, data directory (copy + open), and license notice.
 */

import { invoke, isTauri } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import { Button, Message, Typography } from '@arco-design/web-react';
import { Copy, FolderOpen, Github } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { openExternalUrl } from '@/renderer/utils/platform';
import brandLogo from '@renderer/assets/logos/brand/app.png';

const REPO_URL = 'https://github.com/chenhuowei/AIBaton';
declare const __APP_VERSION__: string;

export const AibatonAbout: React.FC = () => {
  const [dir, setDir] = useState<string>('');

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<string>('get_data_dir')
      .then(setDir)
      .catch((e) => console.warn('[aibaton] get_data_dir failed:', e));
  }, []);

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
    <div className='flex flex-col items-center w-full max-w-500px mx-auto gap-12px pb-24px'>
      <img src={brandLogo} alt='Aibaton' style={{ width: 88, height: 88 }} className='rd-20px' />
      <Typography.Title heading={3} className='text-24px font-bold text-t-primary m-0'>
        Aibaton
      </Typography.Title>
      <Typography.Text className='text-14px text-t-secondary text-center'>
        One desktop. Your AI agents, actually coworking.
      </Typography.Text>

      <div className='flex items-center gap-8px'>
        <span className='px-10px py-4px rd-6px text-13px bg-fill-2 text-t-primary font-500'>v{__APP_VERSION__}</span>
        <Button
          size='mini'
          icon={<Github theme='outline' size='15' />}
          onClick={() => void openExternalUrl(REPO_URL).catch(console.error)}
        >
          Repository
        </Button>
      </div>

      {dir && (
        <div className='flex flex-col gap-8px w-full mt-8px'>
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
      )}

      <Typography.Text className='text-11px text-t-tertiary text-center mt-8px'>
        Built on AionUi 2.2.2 (Apache-2.0) and AionCore v0.2.2. See THIRD-PARTY-NOTICES.md.
      </Typography.Text>
    </div>
  );
};

export default AibatonAbout;
