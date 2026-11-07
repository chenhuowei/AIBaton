/**
 * Aibaton compact sidebar header.
 *
 * Replaces the two stacked bars in upstream AionUi: the outer `.app-titlebar`
 * is removed entirely, and this component takes over the sidebar header to
 * show the Aibaton brand mark, a sidebar toggle, and the native window
 * controls. Search / history-nav / feedback / workspace buttons lived in the
 * removed outer bar and are intentionally not carried over.
 */

import WindowControls from '@/renderer/components/layout/WindowControls';
import { MenuFold } from '@icon-park/react';
import brandLogo from '@renderer/assets/logos/brand/app.png';
import React from 'react';

type Props = {
  collapsed: boolean;
  onToggle: () => void;
  isMac?: boolean;
  isMobile?: boolean;
  onBrandClick: () => void;
  backLabel: string;
  showBack: boolean;
};

const SidebarHeader: React.FC<Props> = ({
  collapsed,
  onToggle,
  isMac = false,
  isMobile = false,
  onBrandClick,
  backLabel,
  showBack,
}) => {
  return (
    <div className='flex items-center justify-start pt-8px pb-8px ps-18px pe-12px gap-12px layout-sider-header'>
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
      <div className='flex-1' />
      {!isMobile && (
        <button
          type='button'
          className='app-titlebar__button'
          onClick={onToggle}
          title='Toggle sidebar'
          aria-label='Toggle sidebar'
        >
          <MenuFold theme='outline' size={16} fill='currentColor' />
        </button>
      )}
      {!isMac && <WindowControls />}
    </div>
  );
};

export default SidebarHeader;
