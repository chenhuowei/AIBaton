/**
 * Aibaton compact sidebar header.
 *
 * Only the brand mark + product name. The outer titlebar was removed and the
 * native window controls are no longer placed here (they wrapped awkwardly
 * next to the logo). Window minimize/maximize/close are left to the OS window
 * frame provided by Tauri.
 */

import brandLogo from '@renderer/assets/logos/brand/app.png';
import React from 'react';

type Props = {
  collapsed: boolean;
  onBrandClick: () => void;
  backLabel: string;
  showBack: boolean;
};

const SidebarHeader: React.FC<Props> = ({ collapsed, onBrandClick, backLabel, showBack }) => {
  return (
    <div className='flex items-center justify-start pt-8px pb-8px ps-18px pe-16px gap-12px layout-sider-header'>
      <img
        src={brandLogo}
        alt='Aibaton'
        className='shrink-0 rd-0.5rem object-contain'
        style={{ width: 32, height: 32 }}
        onClick={onBrandClick}
        role={showBack ? 'button' : undefined}
        aria-label={showBack ? backLabel : 'Aibaton'}
      />
      {!collapsed && (
        <span className='text-16px text-t-primary font-semibold select-none'>{showBack ? backLabel : 'Aibaton'}</span>
      )}
    </div>
  );
};

export default SidebarHeader;
