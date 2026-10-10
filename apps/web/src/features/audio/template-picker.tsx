import { ChevronRight, LayoutTemplate } from 'lucide-react';
import {
  AUDIO_NOTE_CATEGORIES,
  AUDIO_NOTE_TEMPLATES,
  type AudioNoteTemplate,
} from '../../lib/audio-workshop';

interface AudioTemplatePickerProps {
  open: boolean;
  selectedTemplate: AudioNoteTemplate;
  readingHint: string;
  onToggle: () => void;
  onSelect: (templateId: string) => void;
}

export function AudioTemplatePicker({
  open,
  selectedTemplate,
  readingHint,
  onToggle,
  onSelect,
}: AudioTemplatePickerProps) {
  return (
    <div className="border-b border-zinc-100 px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
        >
          <LayoutTemplate size={16} />
          主题模板：{selectedTemplate.name}
          <ChevronRight size={14} className={open ? 'rotate-90 transition-transform' : 'transition-transform'} />
        </button>
        <p className="text-xs leading-5 text-zinc-500">{readingHint}</p>
      </div>

      {open && (
        <div className="mt-4 rounded-[24px] border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex gap-3 overflow-x-auto pb-2 text-sm">
            {AUDIO_NOTE_CATEGORIES.map((category) => (
              <span key={category} className="shrink-0 rounded-full bg-white px-3 py-1 font-medium text-zinc-600">
                {category}
              </span>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {AUDIO_NOTE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelect(template.id)}
                className={`min-h-28 rounded-2xl border px-4 py-3 text-left transition-colors ${
                  template.id === selectedTemplate.id
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-zinc-200 bg-white hover:border-zinc-300'
                }`}
              >
                <div className="text-2xl">{template.icon}</div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-semibold text-zinc-900">{template.name}</span>
                  {template.recommended && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">推荐</span>}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{template.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
