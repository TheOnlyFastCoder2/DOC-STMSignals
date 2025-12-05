import { useRef } from 'react';
import { signal as makeSignal, Signal } from '..';
import { useSignal, useWatch } from './react';
import { Active } from './Active';

type OnChange = React.ChangeEvent<HTMLInputElement>;
type PropsInput = React.DetailedHTMLProps<
  React.InputHTMLAttributes<HTMLInputElement>,
  HTMLInputElement
> & { isHide?: boolean };
type PropsSpan = React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>;

interface FieldConfig<V> {
  initialValue: V;
  title?: string;
  errorMessage?: string;
  validate: (value: V) => boolean;
}

type FormShape = Record<string, unknown>;

export type FormConfig<S extends FormShape> = {
  [K in keyof S]: FieldConfig<S[K]>;
};

type FormData<S extends FormShape> = (formData: { [K in keyof S]: S[K] }) => void | Promise<void>;
type FieldSignals<V> = {
  value: Signal<V>;
  title: Signal<string>;
  errorMessage: Signal<string>;
};

class Form<S extends FormShape> {
  private formSignals: { [K in keyof S]: FieldSignals<S[K]> };
  private config: FormConfig<S>;
  public isValidForm = makeSignal(false);
  public isSubmitted = makeSignal<null | boolean>(null);

  constructor(config: FormConfig<S>) {
    this.config = config;
    this.formSignals = this.initializeFields(config);
  }

  private initializeFields(cfg: FormConfig<S>): { [K in keyof S]: FieldSignals<S[K]> } {
    const out = {} as { [K in keyof S]: FieldSignals<S[K]> };
    (Object.keys(cfg) as Array<keyof S>).forEach((key) => {
      const fieldConfig = cfg[key];
      out[key] = {
        value: makeSignal(fieldConfig.initialValue),
        title: makeSignal(fieldConfig.title ?? ''),
        errorMessage: makeSignal(fieldConfig.errorMessage ?? ''),
      };
    });
    return out;
  }

  public useField<K extends keyof S>(key: K) {
    const sigs = this.formSignals[key];
    const fieldConfig = this.config[key];
    const ref = useRef<HTMLInputElement>(null);
    const label = useSignal(sigs.title.v);
    const message = useSignal(sigs.errorMessage.v);

    useWatch(() => {
      if (!ref.current) return;

      (ref.current as HTMLInputElement).value = String(sigs.value.v ?? '');
      label.v = sigs.title.v;
      message.v = sigs.errorMessage.v;
    });

    return {
      sg: sigs,
      Input: ({ className = '', onChange, isHide = false, style, ...props }: PropsInput) => {
        const _onChange = (e: OnChange) => {
          if (!e) return;
          const t = e.target;
          let next: unknown;

          if (props.type === 'checkbox' || props.type === 'radio') {
            next = t.checked;
          } else if (props.type === 'number') {
            next = Number(t.value);
          } else {
            next = t.value;
          }

          this.updateField(key, next as S[K]);
          onChange?.(e);
        };

        return (
          <input
            {...props}
            style={
              isHide ? { position: 'absolute', pointerEvents: 'none', opacity: 0, ...style } : style
            }
            className={className}
            ref={(e) => {
              ref.current = e;
              const _ref = props.ref;
              if (_ref && 'current' in (_ref as any)) {
                (_ref as any).current = e;
              }
            }}
            onChange={_onChange}
          />
        );
      },

      Title: ({ className = '', ...props }: PropsSpan) => {
        return (
          <Active sg={sigs.title} is={() => !!fieldConfig.title}>
            <span {...props} className={className}>
              {label.c}
            </span>
          </Active>
        );
      },

      Error: ({ className = '', ...props }: PropsSpan) => {
        return (
          <Active
            sg={sigs.value}
            is={() => !!sigs.value.v && !!sigs.errorMessage.v && !this.validateField(key)}
          >
            <span {...props} className={className}>
              {message.c}
            </span>
          </Active>
        );
      },
    };
  }

  public getSignalField<K extends keyof S>(key: K) {
    return this.formSignals[key];
  }

  public updateField<K extends keyof S>(key: K, value: S[K]) {
    const sigs = this.formSignals[key];
    if (sigs) {
      sigs.value.v = value;
    }
  }

  public validateField<K extends keyof S>(key: K) {
    const sigs = this.formSignals[key];
    const fieldConfig = this.config[key];

    const val = sigs.value.v;

    if (typeof val === 'string' && val.trim() === '') {
      sigs.errorMessage.v = fieldConfig.errorMessage ?? '';
      return false;
    }
    if (typeof val === 'boolean' && !val) {
      sigs.errorMessage.v = fieldConfig.errorMessage ?? '';
      return false;
    }
    if (typeof val === 'number' && (isNaN(val) || val === 0)) {
      sigs.errorMessage.v = fieldConfig.errorMessage ?? '';
      return false;
    }

    return fieldConfig.validate(val);
  }

  public validateForm() {
    let isValid = true;
    (Object.keys(this.formSignals) as Array<keyof S>).some((key) => {
      if (!this.validateField(key)) {
        isValid = false;
        return true;
      }
      return false;
    });
    return isValid;
  }

  public async onSubmit(callback: FormData<S>) {
    const isValid = this.validateForm();
    this.isSubmitted.v = true;

    if (!isValid) return;
    this.isValidForm.v = true;

    const formData = (
      Object.entries(this.formSignals) as [keyof S, FieldSignals<S[keyof S]>][]
    ).reduce(
      (acc, [key, sigs]) => {
        acc[key] = sigs.value.v as S[typeof key];
        return acc;
      },
      {} as { [K in keyof S]: S[K] }
    );
    this.isValidForm.v = false;
    await callback(formData);
  }
}

export function useForm<T extends FormShape>(formConfig:FormConfig<T>) {
  const formRef = useRef<Form<T> | null>(null);
  if (!formRef.current) {
    formRef.current = new Form<T>(formConfig);
  }

  return formRef.current;
}
export default Form;
