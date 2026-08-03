"""Доменная модель сценария нагрузочного тестирования.

Модель НЕ зависит от движка (JMeter/k6). Является эталонным контрактом,
которым обмениваются analyzer, constructor и frontend.
См. docs/domain-model.md.
"""
from __future__ import annotations

from enum import Enum
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field


class HttpMethod(str, Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"
    HEAD = "HEAD"
    OPTIONS = "OPTIONS"


class SourceType(str, Enum):
    OPENAPI = "openapi"
    POSTMAN = "postman"


class ParamLocation(str, Enum):
    PATH = "path"
    QUERY = "query"
    HEADER = "header"
    BODY = "body"


class BodyMode(str, Enum):
    NONE = "none"
    RAW = "raw"
    JSON = "json"
    FORM = "form"


class KeyValue(BaseModel):
    key: str
    value: str = ""


class Body(BaseModel):
    mode: BodyMode = BodyMode.NONE
    content_type: Optional[str] = None
    content: str = ""


# --- Стратегии заполнения параметра -------------------------------------------------

class GeneratorType(str, Enum):
    UUID = "uuid"
    RANDOM_INT = "randomInt"
    RANDOM_STRING = "randomString"
    COUNTER = "counter"
    TIMESTAMP = "timestamp"


class Generator(BaseModel):
    type: GeneratorType
    min: Optional[int] = None
    max: Optional[int] = None
    length: Optional[int] = None
    chars: Optional[str] = None
    start: Optional[int] = None
    format: Optional[str] = None


class ConstantSource(BaseModel):
    kind: Literal["constant"] = "constant"
    value: str = ""


class GeneratorSource(BaseModel):
    kind: Literal["generator"] = "generator"
    generator: Generator


class CorrelationSource(BaseModel):
    kind: Literal["correlation"] = "correlation"
    variable: str


class CsvSource(BaseModel):
    kind: Literal["csv"] = "csv"
    column: str


ParamSource = Union[ConstantSource, GeneratorSource, CorrelationSource, CsvSource]


class Param(BaseModel):
    name: str
    location: ParamLocation
    source: ParamSource = Field(default_factory=ConstantSource)
    # Подсказки из схемы (для UI и будущего ИИ): тип, пример, обязательность
    schema_type: Optional[str] = None
    example: Optional[str] = None
    required: bool = False


# --- Корреляция (источник) ----------------------------------------------------------

class ExtractionType(str, Enum):
    JSON = "json"
    REGEX = "regex"
    BOUNDARY = "boundary"


class Extraction(BaseModel):
    variable: str
    type: ExtractionType = ExtractionType.JSON
    expression: str
    match_no: int = 1
    default_value: str = "NOT_FOUND"


# --- Валидация ответа ---------------------------------------------------------------

class Validation(BaseModel):
    """Проверки ответа. Код ответа проверяется всегда; подстрока (Response
    Assertion Contains) — опционально, предзаполняется именем поля из swagger."""
    check_response_code: bool = True
    expected_status: int = 200
    response_contains: str = ""


# --- Интенсивность (только Throughput Shaping Timer) --------------------------------

class Intensity(BaseModel):
    """Профиль интенсивности группы. target_rps трактуется как ПИК."""
    target_rps: float = 10.0
    ramp_up_sec: int = 30
    hold_sec: int = 60


# --- Датасеты (CSV) -----------------------------------------------------------------

class Dataset(BaseModel):
    """CSV-датасет уровня сценария. Может задаваться инлайн (rows) или загрузкой CSV.
    Запросы, использующие один датасет, попадают в одну тред-группу с единой интенсивностью."""
    id: str
    name: str
    file_name: str
    columns: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)
    random: bool = False  # случайный выбор строк (Random CSV Data Set)


class AutoStop(BaseModel):
    """AutoStop Listener (плагин jpgc-autostop). Порог 0 отключает критерий."""
    enabled: bool = False
    error_rate_pct: float = 0.0
    error_rate_sec: int = 0
    avg_response_ms: int = 0
    avg_response_sec: int = 0


class PrometheusConfig(BaseModel):
    """Backend Listener Prometheus (kolesnikovm/jmeter-prometheus-listener)."""
    exporter_port: int = 9001
    run_id: str = "1"
    samplers_reg_exp: str = ".*"
    slo_levels: str = "0.1;1"


# --- Запрос и сценарий --------------------------------------------------------------

class Request(BaseModel):
    id: str
    order: int
    name: str
    method: str
    path: str
    headers: list[KeyValue] = Field(default_factory=list)
    query_params: list[Param] = Field(default_factory=list)
    body: Body = Field(default_factory=Body)
    params: list[Param] = Field(default_factory=list)
    extractions: list[Extraction] = Field(default_factory=list)
    intensity: Intensity = Field(default_factory=Intensity)
    validation: Validation = Field(default_factory=Validation)
    dataset_id: Optional[str] = None
    repeat: int = 1  # число повторов за итерацию потока (Loop Controller)


class TestMode(str, Enum):
    RAMP_HOLD = "ramp_hold"
    MAX_SEARCH = "max_search"


class LoadConfig(BaseModel):
    """Параметры нагрузки уровня сценария."""
    test_mode: TestMode = TestMode.RAMP_HOLD
    steps: int = 5            # число ступеней (для max_search)
    step_duration_sec: int = 60   # длительность ступени (для max_search)
    assumed_latency_sec: float = 1.0  # для расчёта Target Concurrency групп


class ScenarioDraft(BaseModel):
    name: str
    source_type: SourceType
    base_url: str = ""
    load: LoadConfig = Field(default_factory=LoadConfig)
    datasets: list[Dataset] = Field(default_factory=list)
    autostop: AutoStop = Field(default_factory=AutoStop)
    prometheus: PrometheusConfig = Field(default_factory=PrometheusConfig)
    requests: list[Request] = Field(default_factory=list)


# --- Запрос на анализ ---------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    source_type: SourceType
    # ровно одно из полей ниже
    url: Optional[str] = None
    content: Optional[str] = None
    name: Optional[str] = None
